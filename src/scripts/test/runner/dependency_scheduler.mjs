/**
 * 依赖感知 suite 调度：依赖完成后按 footprint 优先派发，未满足则 blocked。
 */
import { listUnsatisfiedDependencies } from '../core/dependencies.mjs'
import { suiteSchedulePriority } from '../core/resources.mjs'
import { isDependencySatisfied, isSuiteOutdated, suiteKey } from '../core/state.mjs'

import { ResourceRunGate } from './scheduler.mjs'

/**
 * @typedef {import('../core/manifest.mjs').SuiteDef} SuiteDef
 * @typedef {import('../core/state.mjs').TestState} TestState
 */

/**
 * @typedef {object} DependencyRunContext
 * @property {string} commitHash
 * @property {string | null} uncommittedHash
 * @property {Map<string, string[]>} changedSinceRecordByKey
 * @property {Set<string>} runGreenKeys
 * @property {Map<string, SuiteDef>} byKey
 */

/**
 * @typedef {object} ScheduledRunOutcome
 * @property {'run' | 'blocked'} kind
 * @property {SuiteDef} suite
 * @property {string[]} [blockedBy]
 */

/**
 * 依赖就绪派发协调器。
 */
export class DependencyRunCoordinator {
	/**
	 * @param {object} options 选项
	 * @param {SuiteDef[]} options.suites 拓扑有序待运行 suite
	 * @param {TestState} options.state 现状库
	 * @param {DependencyRunContext} options.context 运行上下文
	 * @param {ResourceRunGate} options.gate 并发闸门
	 */
	constructor({ suites, state, context, gate }) {
		this.suites = suites
		this.state = state
		this.context = context
		this.gate = gate
		/** @type {Set<string>} 本次运行选中的 suite 键；用于区分“同批依赖”与“需查现状库的外部依赖” */
		this.selectedKeys = new Set(suites.map(suite => suiteKey(suite.manifestId, suite.name)))
		/** @type {Set<string>} */
		this.resolvedKeys = new Set()
	}

	/**
	 * @param {(outcome: ScheduledRunOutcome) => Promise<{ passed: boolean }>} handler 处理单个 suite
	 * @returns {Promise<void>}
	 */
	async runAll(handler) {
		/** @type {Record<string, Promise<void>>} Deno #35798：完成后须自删，勿长期保留 settled Promise */
		const inFlight = {}

		while (this.resolvedKeys.size < this.suites.length) {
			const ready = this.#listReady(inFlight)
			if (!ready.length) {
				const pending = Object.values(inFlight)
				if (!pending.length) break
				await Promise.race(pending)
				continue
			}

			// 并行时按资源体量填箱择优（BFD）；串行时保持 #listReady 的报告拓扑序，
			// 交给 gate 按 FIFO 逐个放行。
			if (!this.gate.serial)
				ready.sort((a, b) => this.#dispatchPriority(b) - this.#dispatchPriority(a))

			for (const suite of ready) {
				const key = suiteKey(suite.manifestId, suite.name)
				const blockedBy = listUnsatisfiedDependencies(suite, this.state, this.context)

				const task = (async () => {
					try {
						if (blockedBy.length) {
							await handler({ kind: 'blocked', suite, blockedBy })
							return
						}

						const release = await this.gate.acquire(suite)
						try {
							const result = await handler({ kind: 'run', suite })
							if (result.passed) this.context.runGreenKeys.add(key)
						}
						finally {
							release()
						}
					}
					finally {
						this.resolvedKeys.add(key)
					}
				})()
				inFlight[key] = task
				void task.finally(() => { delete inFlight[key] })
			}

			await Promise.race(Object.values(inFlight))
		}

		await Promise.all(Object.values(inFlight))
	}

	/**
	 * @param {Record<string, Promise<void>>} inFlight 进行中任务
	 * @returns {SuiteDef[]} 依赖已就绪、尚未派发的 suite
	 */
	#listReady(inFlight) {
		/** @type {SuiteDef[]} */
		const ready = []
		for (const suite of this.suites) {
			const key = suiteKey(suite.manifestId, suite.name)
			if (this.resolvedKeys.has(key) || key in inFlight) continue
			if (!this.#dependenciesResolved(suite)) continue
			ready.push(suite)
		}
		return ready
	}

	/**
	 * @param {SuiteDef} suite suite
	 * @returns {number} 派发优先级（越大越先 acquire）
	 */
	#dispatchPriority(suite) {
		const entry = this.state.suites[suiteKey(suite.manifestId, suite.name)]
		return suiteSchedulePriority(suite, entry)
	}

	/**
	 * @param {SuiteDef} suite suite
	 * @returns {boolean} 全部依赖是否已 resolved
	 */
	#dependenciesResolved(suite) {
		for (const dep of suite.dependencies ?? []) {
			const depKey = suiteKey(dep.manifestId, dep.name)
			if (this.resolvedKeys.has(depKey)) continue
			if (!this.selectedKeys.has(depKey)) {
				const depSuite = this.context.byKey.get(depKey)
				const entry = this.state.suites[depKey]
				const outdated = depSuite
					? isSuiteOutdated(depSuite, entry, this.context.changedSinceRecordByKey.get(depKey) ?? [])
					: true
				if (isDependencySatisfied(entry, outdated))
					continue
			}
			return false
		}
		return true
	}
}
