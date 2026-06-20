/**
 * Deno Worker：在独立线程中运行单次仿真。
 */
import { runSimulation } from './model.mjs'
import { resolveScenarios } from './scenarios.mjs'

/**
 * @typedef {{
 *   id: number,
 *   scenarioId: string,
 *   seed: number,
 *   tunables: import('./tunables_bundle.mjs').TunablesBundle,
 *   attackGenome?: import('./attack_space.mjs').AttackGenome,
 * }} SimWorkerJob
 */

self.addEventListener('message', (/** @type {MessageEvent<SimWorkerJob>} */ event) => {
	const job = event.data
	const scenario = resolveScenarios(job.scenarioId)[0]
	if (!scenario) {
		self.postMessage({ id: job.id, error: `unknown scenario: ${job.scenarioId}` })
		return
	}
	try {
		const snapshot = runSimulation(scenario, job.seed, job.tunables, job.attackGenome)
		self.postMessage({ id: job.id, snapshot })
	}
	catch (err) {
		self.postMessage({ id: job.id, error: String(err) })
	}
})
