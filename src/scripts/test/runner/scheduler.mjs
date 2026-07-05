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
 * @typedef {object} GateWaiter
 * @property {SuiteDef} suite 等待中的 suite
 * @property {(release: () => void) => void} resolve acquire 回调
 */

/**
 * 资源预算闸门：heavy 独占；light suite 按 mem/cpu 与机器余量并行，填缝择优唤醒。
 */
export class ResourceRunGate {
	/**
	 * @param {number} memBudgetBytes 机器内存预算
	 * @param {(suite: SuiteDef) => SuiteStateEntry | undefined} [lookupEntry] 现状库查询
	 * @param {{ serial?: boolean }} [options] serial 时一次只跑一个非 heavy suite
	 */
	constructor(memBudgetBytes, lookupEntry = () => undefined, { serial = false } = {}) {
		this.memBudgetBytes = memBudgetBytes
		this.cpuBudgetPct = CPU_BUDGET_PCT
		this.lookupEntry = lookupEntry
		this.serial = serial
		this.usedMemBytes = 0
		this.usedCpuPct = 0
		/** @type {boolean} */
		this.exclusiveRunning = false
		/** @type {GateWaiter[]} */
		this.waiters = []
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
		if (this.serial) return this.usedMemBytes === 0 && this.usedCpuPct === 0
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

	/** 在余量内尽可能多地按填缝分数唤醒 waiter。 */
	#tryAdmit() {
		if (this.exclusiveRunning) return

		if (this.usedMemBytes === 0 && this.usedCpuPct === 0) {
			const heavyIdx = this.waiters.findIndex(w => w.suite.heavy)
			if (heavyIdx >= 0) {
				const [w] = this.waiters.splice(heavyIdx, 1)
				this.exclusiveRunning = true
				w.resolve(() => this.#releaseExclusive())
				return
			}
		}

		for (;;) {
			let bestIdx = -1
			let bestScore = -1
			for (let i = 0; i < this.waiters.length; i++) {
				const w = this.waiters[i]
				if (w.suite.heavy) continue
				const need = this.#needs(w.suite)
				if (!this.#canFit(need)) continue
				const score = this.#fillScore(need)
				if (score > bestScore) {
					bestScore = score
					bestIdx = i
				}
			}
			if (bestIdx < 0) break

			const [w] = this.waiters.splice(bestIdx, 1)
			const need = this.#needs(w.suite)
			this.usedMemBytes += resourcesMemBytes(need)
			this.usedCpuPct += need.cpuPct
			w.resolve(() => this.#releaseSlot(need))
			if (this.serial) break
		}
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
		this.#tryAdmit()
	}

	/**
	 * @param {SuiteResources} need 已占用的资源
	 */
	#releaseSlot(need) {
		this.usedMemBytes -= resourcesMemBytes(need)
		this.usedCpuPct -= need.cpuPct
		this.#tryAdmit()
	}
}
