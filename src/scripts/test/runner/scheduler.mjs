/**
 * suite 并发调度：heavy 独占；其余按 mem + CPU% 二维预算装箱（填缝择优）。
 */
import { CPU_BUDGET_PCT } from '../core/baseline.mjs'
import {
	resolveSuiteResources,
	resourcesMemBytes,
} from '../core/resources.mjs'

/**
 * @typedef {import('../core/manifest.mjs').SuiteDef} SuiteDef
 * @typedef {import('../core/state.mjs').SuiteStateEntry} SuiteStateEntry
 * @typedef {import('../core/resources.mjs').SuiteResources} SuiteResources
 */

/**
 * 资源闸门等待中的 suite。
 * @typedef {object} GateWaiter
 * @property {SuiteDef} suite 等待中的 suite
 * @property {(release: () => void) => void} resolve acquire 回调
 */

/**
 * 资源预算闸门：heavy 独占；light suite 按 mem/cpu 与机器余量并行，填缝择优唤醒。
 *
 * 不变量：有 waiter 且机器空闲时必须放行至少一个——预算只约束「还能不能再塞」，
 * 从不约束「能不能开工」。否则 oversized suite 会永久挂死。
 */
export class ResourceRunGate {
	/**
	 * 创建资源运行门。
	 * @param {number} memBudgetBytes 机器内存预算
	 * @param {(suite: SuiteDef) => SuiteStateEntry | undefined} [lookupEntry] 现状库查询
	 * @param {object} [options] 选项
	 * @param {(state: { usedMemBytes: number, usedCpuPct: number, exclusiveRunning: boolean }) => void} [options.onChange] 占用状态变化回调
	 */
	constructor(memBudgetBytes, lookupEntry = () => undefined, { onChange = () => { } } = {}) {
		this.memBudgetBytes = memBudgetBytes
		this.cpuBudgetPct = CPU_BUDGET_PCT
		this.lookupEntry = lookupEntry
		this.usedMemBytes = 0
		this.usedCpuPct = 0
		/** @type {boolean} */
		this.exclusiveRunning = false
		/** @type {GateWaiter[]} */
		this.waiters = []
		this.onChange = onChange
	}

	/** 占用状态变化后通知（供理想调度重建时间表）。 */
	#notifyChange() {
		this.onChange({
			usedMemBytes: this.usedMemBytes,
			usedCpuPct: this.usedCpuPct,
			exclusiveRunning: this.exclusiveRunning,
		})
	}

	/**
	 * @param {SuiteDef} suite suite
	 * @returns {SuiteResources} 有效资源
	 */
	#needs(suite) {
		return resolveSuiteResources(suite, this.lookupEntry(suite))
	}

	/**
	 * @param {SuiteResources} need 需求
	 * @returns {boolean} 当前余量是否足够（非 heavy）
	 */
	#canFit(need) {
		if (this.usedMemBytes + resourcesMemBytes(need) > this.memBudgetBytes) return false
		if (this.usedCpuPct + need.cpuPct > this.cpuBudgetPct) return false
		return true
	}

	/**
	 * 装入 need 后两维利用率的瓶颈值（越高越满，用于填缝择优）。
	 * @param {SuiteResources} need 需求
	 * @returns {number} min(memUtil, cpuUtil)
	 */
	#fillScore(need) {
		const memAfter = this.usedMemBytes + resourcesMemBytes(need)
		const cpuAfter = this.usedCpuPct + need.cpuPct
		return Math.min(memAfter / this.memBudgetBytes, cpuAfter / this.cpuBudgetPct)
	}

	/**
	 * 立即放行一个 waiter：heavy 占独占位，其余从余量扣减其资源。
	 * @param {GateWaiter} w waiter
	 */
	#admit(w) {
		if (w.suite.heavy) {
			this.exclusiveRunning = true
			this.#notifyChange()
			w.resolve(() => this.#releaseExclusive())
			return
		}
		const need = this.#needs(w.suite)
		this.usedMemBytes += resourcesMemBytes(need)
		this.usedCpuPct += need.cpuPct
		this.#notifyChange()
		w.resolve(() => this.#releaseSlot(need))
	}

	/**
	 * 在 light waiter 中挑一个：能装下的按填缝分数，否则（仅空闲开工）任意一个。
	 * @param {boolean} requireFit 是否要求能装进当前余量
	 * @returns {number} waiter 下标；无候选 -1
	 */
	#pickLightWaiterIndex(requireFit) {
		let bestIdx = -1
		let bestScore = -1
		for (let i = 0; i < this.waiters.length; i++) {
			const w = this.waiters[i]
			if (w.suite.heavy) continue
			const need = this.#needs(w.suite)
			if (requireFit && !this.#canFit(need)) continue
			if (!requireFit) return i
			const score = this.#fillScore(need)
			if (score > bestScore) {
				bestScore = score
				bestIdx = i
			}
		}
		return bestIdx
	}

	/** 先保证非空转，再在余量内填缝。 */
	#tryAdmit() {
		if (this.exclusiveRunning) return

		const idle = this.usedMemBytes === 0 && this.usedCpuPct === 0
		if (idle && this.waiters.length) {
			const heavyIdx = this.waiters.findIndex(w => w.suite.heavy)
			if (heavyIdx >= 0) {
				this.#admit(this.waiters.splice(heavyIdx, 1)[0])
				return
			}
			const startIdx = this.#pickLightWaiterIndex(true)
			const idx = startIdx >= 0 ? startIdx : this.#pickLightWaiterIndex(false)
			if (idx >= 0) this.#admit(this.waiters.splice(idx, 1)[0])
		}

		while(true) {
			const bestIdx = this.#pickLightWaiterIndex(true)
			if (bestIdx < 0) break
			this.#admit(this.waiters.splice(bestIdx, 1)[0])
		}
	}

	/**
	 * 若当前余量能装下则立即占用；否则返回 null（不排队）。
	 * 供 dependsOn 乐观并行：硬跑已占坑后的余量可投机填入。
	 * 装不下的硬就绪会走 acquire 排队；不因此禁止更小的投机包吃掉剩余碎屑。
	 * @param {SuiteDef} suite 待运行 suite
	 * @returns {(() => void) | null} 释放函数；装不下则为 null
	 */
	tryAcquire(suite) {
		if (this.exclusiveRunning) return null
		if (suite.heavy) {
			if (this.usedMemBytes !== 0 || this.usedCpuPct !== 0) return null
			this.exclusiveRunning = true
			this.#notifyChange()
			return () => this.#releaseExclusive()
		}
		const need = this.#needs(suite)
		if (!this.#canFit(need)) return null
		this.usedMemBytes += resourcesMemBytes(need)
		this.usedCpuPct += need.cpuPct
		this.#notifyChange()
		return () => this.#releaseSlot(need)
	}

	/**
	 * 等待并获取运行槽位。
	 * @param {SuiteDef} suite 待运行 suite
	 * @returns {Promise<() => void>} 释放函数
	 */
	async acquire(suite) {
		return new Promise(resolve => {
			this.waiters.push({ suite, resolve })
			this.#tryAdmit()
		})
	}

	/** 释放 heavy 独占槽位。 */
	#releaseExclusive() {
		this.exclusiveRunning = false
		this.#notifyChange()
		this.#tryAdmit()
	}

	/**
	 * 释放 light 槽位占用的 mem/cpu 预算并尝试唤醒 waiter。
	 * @param {SuiteResources} need 已占用的资源
	 */
	#releaseSlot(need) {
		this.usedMemBytes -= resourcesMemBytes(need)
		this.usedCpuPct -= need.cpuPct
		this.#notifyChange()
		this.#tryAdmit()
	}
}
