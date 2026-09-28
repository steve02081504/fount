/**
 * suite 并发调度：heavy 独占；其余按 mem + CPU% 二维预算装箱（填缝择优）。
 */
import { CPU_BUDGET_PCT } from '../core/baseline.mjs'
import {
	resolveSerialUnitResources,
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
 * 资源闸门等待中的 serial 单元。
 * @typedef {object} UnitWaiter
 * @property {SuiteDef} suite 等待中的 suite
 * @property {(release: () => void) => void} resolve 获取回调
 * @property {(error: Error) => void} reject 中止回调
 * @property {AbortSignal | undefined} signal 中止信号
 * @property {() => void} onAbort 中止监听器
 */

/**
 * 由中止信号构造拒绝原因：优先复用 signal.reason，否则退化为 AbortError。
 * @param {AbortSignal | undefined} signal 中止信号
 * @returns {Error} 拒绝原因
 */
function unitAbortError(signal) {
	const reason = signal?.reason
	if (reason instanceof Error) return reason
	return new DOMException('unit lease aborted', 'AbortError')
}

/**
 * 包装为只生效一次的函数：崩溃 worker 迟到的释放/回收不得二次扣减预算。
 * @param {() => void} fn 原函数
 * @returns {() => void} 幂等包装
 */
function once(fn) {
	let done = false
	return () => {
		if (done) return
		done = true
		fn()
	}
}

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
		this.#usedUnitMemBytes = 0
		this.#usedUnitCpuPct = 0
		/** @type {boolean} */
		this.exclusiveRunning = false
		/** @type {GateWaiter[]} */
		this.waiters = []
		/** @type {UnitWaiter[]} */
		this.#unitWaiters = []
		/** @type {Map<SuiteDef, Set<() => void>>} */
		this.#unitReleases = new Map()
		this.onChange = onChange
	}

	/** @type {number} */
	#usedUnitMemBytes
	/** @type {number} */
	#usedUnitCpuPct
	/** @type {UnitWaiter[]} */
	#unitWaiters
	/** @type {Map<SuiteDef, Set<() => void>>} */
	#unitReleases

	/** @returns {number} 单元池已占内存字节 */
	get usedUnitMemBytes() {
		return this.#usedUnitMemBytes
	}

	/** @returns {number} 单元池已占 CPU 份额 */
	get usedUnitCpuPct() {
		return this.#usedUnitCpuPct
	}

	/** @returns {number} 等待中的单元数 */
	get unitWaiterCount() {
		return this.#unitWaiters.length
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
	 * @param {SuiteDef} suite suite
	 * @returns {SuiteResources} 单元有效资源
	 */
	#unitNeeds(suite) {
		return resolveSerialUnitResources(suite, this.lookupEntry(suite))
	}

	/**
	 * 两维合计余量是否装得下需求——suite 与单元共享同一预算，故都叠加对侧占用。
	 * @param {SuiteResources} need 需求
	 * @returns {boolean} 是否足够（非 heavy）
	 */
	#canFit(need) {
		if (this.usedMemBytes + this.#usedUnitMemBytes + resourcesMemBytes(need) > this.memBudgetBytes) return false
		if (this.usedCpuPct + this.#usedUnitCpuPct + need.cpuPct > this.cpuBudgetPct) return false
		return true
	}

	/**
	 * 装入 need 后两维利用率的瓶颈值（越高越满，用于填缝择优）。
	 * @param {SuiteResources} need 需求
	 * @returns {number} min(memUtil, cpuUtil)
	 */
	#fillScore(need) {
		const memAfter = this.usedMemBytes + this.#usedUnitMemBytes + resourcesMemBytes(need)
		const cpuAfter = this.usedCpuPct + this.#usedUnitCpuPct + need.cpuPct
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
		w.resolve(() => this.#releaseSuite(w.suite, need))
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

		while (true) {
			const bestIdx = this.#pickLightWaiterIndex(true)
			if (bestIdx < 0) break
			this.#admit(this.waiters.splice(bestIdx, 1)[0])
		}
	}

	/**
	 * 占用单元预算（单元与 suite 共享同一资源池）。
	 * @param {SuiteResources} need 单元需求
	 */
	#occupyUnit(need) {
		this.#usedUnitMemBytes += resourcesMemBytes(need)
		this.#usedUnitCpuPct += need.cpuPct
		this.#notifyChange()
	}

	/**
	 * 立即放行一个单元 waiter；其释放登记到所属 suite，供 suite 结束时统一回收。
	 * @param {UnitWaiter} w waiter
	 */
	#admitUnit(w) {
		w.signal?.removeEventListener('abort', w.onAbort)
		const need = this.#unitNeeds(w.suite)
		this.#occupyUnit(need)
		let releases = this.#unitReleases.get(w.suite)
		if (!releases) this.#unitReleases.set(w.suite, releases = new Set())
		/** 单元独立释放：先从 suite 登记中摘除，再归还预算。 */
		const release = once(() => {
			releases.delete(release)
			this.#releaseUnit(need)
		})
		releases.add(release)
		w.resolve(release)
	}

	/**
	 * 在单元 waiter 中挑一个：能装下的按填缝分数，否则（仅空闲开工）任意一个。
	 * @param {boolean} requireFit 是否要求能装进当前余量
	 * @returns {number} waiter 下标；无候选 -1
	 */
	#pickUnitWaiterIndex(requireFit) {
		let bestIdx = -1
		let bestScore = -1
		for (let i = 0; i < this.#unitWaiters.length; i++) {
			const need = this.#unitNeeds(this.#unitWaiters[i].suite)
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

	/**
	 * 单元池放行：先保证非空转（单元与 suite 全空才算空闲），再按单元需求填缝。
	 */
	#tryAdmitUnits() {
		if (this.exclusiveRunning) return

		const machineIdle = this.#usedUnitMemBytes === 0 && this.#usedUnitCpuPct === 0
			&& this.usedMemBytes === 0 && this.usedCpuPct === 0
		if (machineIdle && this.#unitWaiters.length) {
			const startIdx = this.#pickUnitWaiterIndex(true)
			const idx = startIdx >= 0 ? startIdx : this.#pickUnitWaiterIndex(false)
			if (idx >= 0) this.#admitUnit(this.#unitWaiters.splice(idx, 1)[0])
		}

		while (true) {
			const bestIdx = this.#pickUnitWaiterIndex(true)
			if (bestIdx < 0) break
			this.#admitUnit(this.#unitWaiters.splice(bestIdx, 1)[0])
		}
	}

	/**
	 * 等待并获取一个单元租约。
	 * @param {SuiteDef} suite 待运行 suite
	 * @param {AbortSignal} [signal] 中止信号；中止则移除 waiter 并以 Error 拒绝
	 * @returns {Promise<() => void>} 释放函数
	 */
	async acquireUnit(suite, signal) {
		return new Promise((resolve, reject) => {
			if (signal?.aborted) {
				reject(unitAbortError(signal))
				return
			}
			/** @type {UnitWaiter} */
			const waiter = { suite, resolve, reject, signal, /** @returns {void} 中止监听器占位，随后赋值 */ onAbort: () => { } }
			/** 中止时移除 waiter 并以信号原因拒绝 */
			waiter.onAbort = () => {
				const idx = this.#unitWaiters.indexOf(waiter)
				if (idx >= 0) this.#unitWaiters.splice(idx, 1)
				reject(unitAbortError(signal))
			}
			signal?.addEventListener('abort', waiter.onAbort, { once: true })
			this.#unitWaiters.push(waiter)
			this.#tryAdmitUnits()
		})
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
		return () => this.#releaseSuite(suite, need)
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
		this.#tryAdmitUnits()
	}

	/**
	 * 释放 suite 槽位：先回收其仍在册的单元租约（worker 崩溃不调 `/unit/release` 也不会漏），
	 * 再归还 suite 预算。
	 * @param {SuiteDef} suite 已结束的 suite
	 * @param {SuiteResources} need 已占用的 suite 资源
	 */
	#releaseSuite(suite, need) {
		this.#releaseSuiteUnits(suite)
		this.#releaseSlot(need)
	}

	/**
	 * 回收某 suite 的全部在册单元租约（逐个幂等，迟到的独立释放为空操作）。
	 * @param {SuiteDef} suite suite
	 */
	#releaseSuiteUnits(suite) {
		const releases = this.#unitReleases.get(suite)
		if (!releases?.size) return
		this.#unitReleases.delete(suite)
		for (const release of [...releases]) release()
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
		this.#tryAdmitUnits()
	}

	/**
	 * 释放单元占用的 mem/cpu 预算并尝试唤醒两池 waiter。
	 * @param {SuiteResources} need 已占用的单元资源
	 */
	#releaseUnit(need) {
		this.#usedUnitMemBytes -= resourcesMemBytes(need)
		this.#usedUnitCpuPct -= need.cpuPct
		this.#notifyChange()
		this.#tryAdmit()
		this.#tryAdmitUnits()
	}
}
