/**
 * 按计划槽位派发：动作已在 buildPlan 中决定，此处只等同批依赖完成。
 */
import { suiteSchedulePriority } from '../core/resources.mjs'
import { suiteKey } from '../core/state.mjs'

import { ResourceRunGate } from './scheduler.mjs'

/**
 * @typedef {import('../core/plan.mjs').PlanSlot} PlanSlot
 */

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
	}

	/**
	 * @param {(slot: PlanSlot) => Promise<{ passed: boolean }>} handler 处理单个槽位
	 * @returns {Promise<void>}
	 */
	async runAll(handler) {
		/** @type {Record<string, Promise<void>>} */
		const inFlight = {}

		while (this.resolvedKeys.size < this.slots.length) {
			const ready = this.#listReady(inFlight)
			if (!ready.length) {
				const pending = Object.values(inFlight)
				if (!pending.length) {
					const unresolved = this.slots
						.filter(slot => !this.resolvedKeys.has(slot.key))
						.map(slot => slot.key)
					throw new Error(`scheduler deadlock: unresolved ${unresolved.join(', ')}`)
				}
				await Promise.race(pending)
				continue
			}

			if (!this.gate.serial)
				ready.sort((a, b) => this.#dispatchPriority(b) - this.#dispatchPriority(a))

			for (const slot of ready) {
				const task = (async () => {
					try {
						if (slot.action === 'run') {
							const release = await this.gate.acquire(slot.suite)
							try {
								await handler(slot)
							}
							finally {
								release()
							}
						}
						else
							await handler(slot)
					}
					finally {
						this.resolvedKeys.add(slot.key)
					}
				})()
				inFlight[slot.key] = task
				void task.finally(() => { delete inFlight[slot.key] })
			}

			const flying = Object.values(inFlight)
			if (flying.length)
				await Promise.race(flying)
		}

		await Promise.all(Object.values(inFlight))
	}

	/**
	 * @param {Record<string, Promise<void>>} inFlight 进行中任务
	 * @returns {PlanSlot[]} 依赖已就绪、尚未派发的槽位
	 */
	#listReady(inFlight) {
		/** @type {PlanSlot[]} */
		const ready = []
		for (const slot of this.slots) {
			if (this.resolvedKeys.has(slot.key) || slot.key in inFlight) continue
			if (!this.#dependenciesResolved(slot)) continue
			ready.push(slot)
		}
		return ready
	}

	/**
	 * @param {PlanSlot} slot 槽位
	 * @returns {number} 派发优先级
	 */
	#dispatchPriority(slot) {
		const entry = this.state.suites[suiteKey(slot.suite.manifestId, slot.suite.name)]
		return suiteSchedulePriority(slot.suite, entry)
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
}
