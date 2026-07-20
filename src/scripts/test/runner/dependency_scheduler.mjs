/**
 * 按计划槽位派发：同批依赖未完成时可乐观并行下游；依赖成功则提交结果，失败则丢弃。
 *
 * 投机与硬跑分权：硬跑仍按 footprint BFD；投机只挂在「正在硬跑」的包旁（不叠投机链），
 * 按就近（同 manifest / 挂靠数）与便宜（丢弃损失小）排序。
 * 硬跑占用机器时，余量仍可 tryAcquire 投机——不因另有硬就绪/排队而停投机。
 */
import { resolveSuiteResources, suiteSchedulePriority } from '../core/resources.mjs'
import { getSuiteBaselineDurationMs, suiteKey } from '../core/state.mjs'

import { ResourceRunGate } from './scheduler.mjs'

/**
 * @typedef {import('../core/plan.mjs').PlanSlot} PlanSlot
 */

/**
 * @typedef {object} CommitGate
 * @property {boolean} ok 是否可提交真跑结果
 * @property {string[]} failedDeps 导致丢弃的失败依赖键
 */

/**
 * @typedef {object} SlotRunContext
 * @property {boolean} speculative 是否在依赖仍在跑时乐观启动
 * @property {boolean} [discardWithoutRun] 依赖已失败，不要真跑、直接记 blocked
 * @property {string[]} [blockedBy] 阻塞来源（plan 或同波次依赖失败）
 * @property {AbortSignal} [signal] 投机跑：依赖失败时 abort，供 runSuite 早停
 * @property {() => Promise<CommitGate>} awaitCommitGate 真跑结束后、写 state 前调用
 */

/** 投机因依赖失败被取消时 AbortSignal.reason */
export const SPECULATIVE_ABORT_REASON = 'speculative-dep-failed'

/**
 * 计划执行协调器。
 */
export class PlanRunCoordinator {
	/**
	 * @param {object} options 选项
	 * @param {PlanSlot[]} options.slots 拓扑有序计划槽位
	 * @param {import('../core/state.mjs').TestState} options.state 现状库
	 * @param {ResourceRunGate} options.gate 并发闸门
	 */
	constructor({ slots, state, gate }) {
		this.slots = slots
		this.state = state
		this.gate = gate
		this.slotKeys = new Set(slots.map(slot => slot.key))
		/** @type {Set<string>} */
		this.resolvedKeys = new Set()
		/** @type {Map<string, boolean>} */
		this.depPassed = new Map()
		/** 本波次以投机方式启动、依赖尚未全部通过的键（不作为下一层投机锚点）。 */
		/** @type {Set<string>} */
		this.#speculativeInFlight = new Set()
		/** @type {Map<string, (() => void)[]>} */
		this.#resolveWaiters = new Map()
	}

	/** @type {Set<string>} */
	#speculativeInFlight
	/** @type {Map<string, (() => void)[]>} */
	#resolveWaiters

	/**
	 * @param {(slot: PlanSlot, ctx: SlotRunContext) => Promise<{ passed: boolean }>} handler 处理单个槽位
	 * @returns {Promise<void>}
	 */
	async runAll(handler) {
		/** @type {Record<string, Promise<void>>} */
		const inFlight = {}

		/**
		 * @param {PlanSlot} slot 槽位
		 * @param {() => Promise<void>} work 任务体
		 * @param {{ speculative?: boolean }} [opts] 选项
		 * @returns {void}
		 */
		const startTask = (slot, work, { speculative = false } = {}) => {
			if (speculative) this.#speculativeInFlight.add(slot.key)
			const task = (async () => {
				try {
					await work()
				}
				catch (error) {
					if (!this.depPassed.has(slot.key)) this.depPassed.set(slot.key, false)
					throw error
				}
				finally {
					if (!this.depPassed.has(slot.key)) this.depPassed.set(slot.key, false)
					this.#speculativeInFlight.delete(slot.key)
					this.#markResolved(slot.key)
				}
			})()
			inFlight[slot.key] = task
			void task.finally(() => { delete inFlight[slot.key] })
		}

		while (this.resolvedKeys.size < this.slots.length) {
			for (const slot of this.#listDepFailed(inFlight))
				startTask(slot, async () => {
					const failedDeps = this.#failedDeps(slot)
					const result = await handler(slot, {
						speculative: false,
						discardWithoutRun: true,
						blockedBy: failedDeps,
						/** @returns {Promise<CommitGate>} 提交闸门 */
						awaitCommitGate: async () => ({ ok: false, failedDeps }),
					})
					this.depPassed.set(slot.key, result.passed)
				})

			const ready = this.#listReady(inFlight)
			if (!this.gate.serial)
				ready.sort((a, b) => this.#hardDispatchPriority(b) - this.#hardDispatchPriority(a))

			for (const slot of ready)
				if (slot.action === 'run') {
					// 同步占坑，避免同轮 speculative tryAcquire 抢在 hard-ready 前面
					let release = this.gate.tryAcquire(slot.suite)
					const waited = release ? null : this.gate.acquire(slot.suite)
					startTask(slot, async () => {
						release ??= await waited
						try {
							const result = await handler(slot, {
								speculative: false,
								/** @returns {Promise<CommitGate>} 提交闸门 */
								awaitCommitGate: async () => ({ ok: true, failedDeps: [] }),
							})
							this.depPassed.set(slot.key, result.passed)
						}
						finally {
							release()
						}
					})
				}
				else
					startTask(slot, async () => {
						const result = await handler(slot, {
							speculative: false,
							blockedBy: slot.blockedBy,
							/** @returns {Promise<CommitGate>} 提交闸门 */
							awaitCommitGate: async () => ({ ok: true, failedDeps: [] }),
						})
						this.depPassed.set(slot.key, result.passed)
					})

			if (!this.gate.serial) {
				// 硬跑（含已占坑/排队）之外：余量能装下就投机，不因另有硬就绪在跑而停
				const speculative = this.#listSpeculative(inFlight)
				speculative.sort((a, b) =>
					this.#speculativePriority(b, inFlight) - this.#speculativePriority(a, inFlight))
				for (const slot of speculative) {
					const release = this.gate.tryAcquire(slot.suite)
					if (!release) continue
					const abortController = new AbortController()
					const stopArm = this.#armSpeculative(slot, abortController)
					startTask(slot, async () => {
						try {
							const result = await handler(slot, {
								speculative: true,
								signal: abortController.signal,
								/** @returns {Promise<CommitGate>} 提交闸门 */
								awaitCommitGate: async () => {
									await this.#waitDepsResolved(slot)
									const failedDeps = this.#failedDeps(slot)
									return failedDeps.length
										? { ok: false, failedDeps }
										: { ok: true, failedDeps: [] }
								},
							})
							this.depPassed.set(slot.key, result.passed)
						}
						finally {
							stopArm()
							release()
						}
					}, { speculative: true })
				}
			}

			const flying = Object.values(inFlight)
			if (!flying.length) {
				const unresolved = this.slots
					.filter(slot => !this.resolvedKeys.has(slot.key))
					.map(slot => slot.key)
				throw new Error(`scheduler deadlock: unresolved ${unresolved.join(', ')}`)
			}
			await Promise.race(flying)
		}

		await Promise.all(Object.values(inFlight))
	}

	/**
	 * 投机生命周期：依赖失败 → abort；全部通过 → 升为硬锚（下游可再挂一层）。
	 * @param {PlanSlot} slot 槽位
	 * @param {AbortController} abortController 取消控制器
	 * @returns {() => void} 停止监视
	 */
	#armSpeculative(slot, abortController) {
		let stopped = false
		const depKeys = (slot.suite.dependencies ?? [])
			.map(dep => suiteKey(dep.manifestId, dep.name))
			.filter(key => this.slotKeys.has(key))

		void (async () => {
			while (!stopped && !abortController.signal.aborted) {
				const pending = depKeys.filter(key => !this.resolvedKeys.has(key))
				if (!pending.length) break
				await Promise.race(pending.map(key => this.#waitKey(key)))
				if (stopped) return
				const failedDeps = this.#failedDeps(slot)
				if (failedDeps.length) {
					abortController.abort(SPECULATIVE_ABORT_REASON)
					return
				}
			}
			if (stopped || abortController.signal.aborted) return
			// 依赖已全部通过：身份升级，允许下游挂靠本包投机
			this.#speculativeInFlight.delete(slot.key)
		})()

		return () => { stopped = true }
	}

	/**
	 * @param {string} key suite 键
	 * @returns {void}
	 */
	#markResolved(key) {
		this.resolvedKeys.add(key)
		const waiters = this.#resolveWaiters.get(key)
		if (!waiters?.length) return
		this.#resolveWaiters.delete(key)
		for (const wake of waiters) wake()
	}

	/**
	 * @param {string} key suite 键
	 * @returns {Promise<void>}
	 */
	#waitKey(key) {
		if (this.resolvedKeys.has(key)) return Promise.resolve()
		return new Promise(resolve => {
			const list = this.#resolveWaiters.get(key) ?? []
			list.push(resolve)
			this.#resolveWaiters.set(key, list)
		})
	}

	/**
	 * @param {PlanSlot} slot 槽位
	 * @returns {Promise<void>}
	 */
	async #waitDepsResolved(slot) {
		await Promise.all(
			(slot.suite.dependencies ?? [])
				.map(dep => suiteKey(dep.manifestId, dep.name))
				.filter(key => this.slotKeys.has(key))
				.map(key => this.#waitKey(key)),
		)
	}

	/**
	 * @param {Record<string, Promise<void>>} inFlight 进行中任务
	 * @returns {PlanSlot[]} 依赖已通过、可派发的槽位
	 */
	#listReady(inFlight) {
		/** @type {PlanSlot[]} */
		const ready = []
		for (const slot of this.slots) {
			if (this.resolvedKeys.has(slot.key) || slot.key in inFlight) continue
			if (!this.#dependenciesResolved(slot)) continue
			if (slot.action === 'run' && !this.#dependenciesPassed(slot)) continue
			ready.push(slot)
		}
		return ready
	}

	/**
	 * 依赖已全部结束且有失败 → 下游不真跑，记 blocked。
	 * @param {Record<string, Promise<void>>} inFlight 进行中任务
	 * @returns {PlanSlot[]} 应记 blocked 的槽位
	 */
	#listDepFailed(inFlight) {
		/** @type {PlanSlot[]} */
		const list = []
		for (const slot of this.slots) {
			if (slot.action !== 'run') continue
			if (this.resolvedKeys.has(slot.key) || slot.key in inFlight) continue
			if (!this.#dependenciesResolved(slot)) continue
			if (this.#dependenciesPassed(slot)) continue
			list.push(slot)
		}
		return list
	}

	/**
	 * 依赖仍在跑、余量允许时乐观并行。
	 * @param {Record<string, Promise<void>>} inFlight 进行中任务
	 * @returns {PlanSlot[]} 可投机启动的槽位
	 */
	#listSpeculative(inFlight) {
		/** @type {PlanSlot[]} */
		const list = []
		for (const slot of this.slots) {
			if (slot.action !== 'run') continue
			if (this.resolvedKeys.has(slot.key) || slot.key in inFlight) continue
			if (!this.#canSpeculate(slot, inFlight)) continue
			list.push(slot)
		}
		return list
	}

	/**
	 * 只挂在「硬跑中」的依赖旁：不叠在另一层投机上，预测翻车时只丢一层。
	 * @param {PlanSlot} slot 槽位
	 * @param {Record<string, Promise<void>>} inFlight 进行中任务
	 * @returns {boolean} 是否允许乐观并行
	 */
	#canSpeculate(slot, inFlight) {
		let anchoredToHard = false
		for (const dep of slot.suite.dependencies ?? []) {
			const depKey = suiteKey(dep.manifestId, dep.name)
			if (!this.slotKeys.has(depKey)) continue
			if (this.resolvedKeys.has(depKey)) {
				if (this.depPassed.get(depKey) !== true) return false
				continue
			}
			if (!(depKey in inFlight)) return false
			// 挂在投机包上的下游等该包升为硬锚或落盘后再说
			if (this.#speculativeInFlight.has(depKey)) return false
			anchoredToHard = true
		}
		return anchoredToHard
	}

	/**
	 * 硬跑装箱：大 footprint 优先（BFD）。
	 * @param {PlanSlot} slot 槽位
	 * @returns {number} 排序键
	 */
	#hardDispatchPriority(slot) {
		const entry = this.state.suites[suiteKey(slot.suite.manifestId, slot.suite.name)]
		return suiteSchedulePriority(slot.suite, entry)
	}

	/**
	 * 投机就近权：与硬跑 footprint 分池。
	 * 挂靠正在硬跑的包越多 / 同 manifest 越近 / 体量与基线越短（丢弃越便宜）→ 越高。
	 * @param {PlanSlot} slot 槽位
	 * @param {Record<string, Promise<void>>} inFlight 进行中任务
	 * @returns {number} 排序键
	 */
	#speculativePriority(slot, inFlight) {
		let near = 0
		for (const dep of slot.suite.dependencies ?? []) {
			const depKey = suiteKey(dep.manifestId, dep.name)
			if (!(depKey in inFlight) || this.#speculativeInFlight.has(depKey)) continue
			near += 10
			if (dep.manifestId === slot.suite.manifestId) near += 5
		}
		const entry = this.state.suites[slot.key]
		const resources = resolveSuiteResources(slot.suite, entry)
		const durationMs = getSuiteBaselineDurationMs(entry) ?? 60_000
		// 便宜优先：与硬跑「大包优先」相反，预测错时损失小
		const cheap = 1_000_000 / (1 + resources.memMb + resources.cpuPct + durationMs / 1000)
		return near + cheap
	}

	/**
	 * @param {PlanSlot} slot 槽位
	 * @returns {boolean} 同批依赖是否已 resolved
	 */
	#dependenciesResolved(slot) {
		for (const dep of slot.suite.dependencies ?? []) {
			const depKey = suiteKey(dep.manifestId, dep.name)
			if (this.slotKeys.has(depKey) && !this.resolvedKeys.has(depKey))
				return false
		}
		return true
	}

	/**
	 * @param {PlanSlot} slot 槽位
	 * @returns {boolean} 同批依赖是否全部通过
	 */
	#dependenciesPassed(slot) {
		for (const dep of slot.suite.dependencies ?? []) {
			const depKey = suiteKey(dep.manifestId, dep.name)
			if (this.slotKeys.has(depKey) && this.depPassed.get(depKey) !== true)
				return false
		}
		return true
	}

	/**
	 * @param {PlanSlot} slot 槽位
	 * @returns {string[]} 已失败的同批依赖键
	 */
	#failedDeps(slot) {
		/** @type {string[]} */
		const failed = []
		for (const dep of slot.suite.dependencies ?? []) {
			const depKey = suiteKey(dep.manifestId, dep.name)
			if (this.slotKeys.has(depKey) && this.resolvedKeys.has(depKey) && this.depPassed.get(depKey) !== true)
				failed.push(depKey)
		}
		return failed
	}
}
