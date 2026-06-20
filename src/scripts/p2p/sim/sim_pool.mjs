/**
 * 仿真任务 Worker 池：并行执行独立 runSimulation job。
 */
/* global Deno */
import { runSimulation } from './model.mjs'
import { resolveScenarios } from './scenarios.mjs'

/**
 * @typedef {{
 *   id: number,
 *   scenarioId: string,
 *   seed: number,
 *   tunables: import('./tunables_bundle.mjs').TunablesBundle,
 *   attackGenome?: import('./attack_space.mjs').AttackGenome,
 * }} SimJob
 */

/**
 * @typedef {{
 *   id: number,
 *   snapshot?: import('./metrics.mjs').SimSnapshot,
 *   error?: string,
 * }} SimJobResult
 */

/**
 * 默认 Worker 并发度：尽量占满逻辑 CPU（无人工上限）。
 * @returns {number} 并发 Worker 数
 */
export function defaultConcurrency() {
	let cores = 0
	if (typeof Deno !== 'undefined' && typeof Deno.systemCpuInfo === 'function') 
		try {
			cores = Deno.systemCpuInfo().cores ?? 0
		}
		catch { /* 非 Deno 或权限不足 */ }
	
	const hw = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
	if (hw) cores = Math.max(cores, hw)
	return Math.max(1, cores || 4)
}

/**
 * @param {SimJob} job 仿真任务
 * @returns {SimJobResult} 快照结果
 */
function runJobLocal(job) {
	const scenario = resolveScenarios(job.scenarioId)[0]
	if (!scenario)
		return { id: job.id, error: `unknown scenario: ${job.scenarioId}` }
	try {
		return {
			id: job.id,
			snapshot: runSimulation(scenario, job.seed, job.tunables, job.attackGenome),
		}
	}
	catch (err) {
		return { id: job.id, error: String(err) }
	}
}

/**
 * @param {SimJob[]} jobs 任务列表
 * @param {{ concurrency?: number }} [opts] 选项
 * @returns {Promise<SimJobResult[]>} 与 jobs 同序的结果
 */
export async function runSimulationJobs(jobs, opts = {}) {
	if (!jobs.length) return []

	const concurrency = opts.concurrency ?? defaultConcurrency()
	if (concurrency <= 1 || typeof Worker === 'undefined')
		return jobs.map(runJobLocal)

	const workerUrl = new URL('./sim_worker.mjs', import.meta.url)
	/** @type {Worker[]} */
	const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, () =>
		new Worker(workerUrl, { type: 'module' }),
	)

	/** @type {SimJobResult[]} */
	const results = new Array(jobs.length)
	let nextJob = 0
	let settled = 0

	return new Promise((resolve, reject) => {
		/**
		 * @param {Worker} worker Worker 实例
		 */
		function assign(worker) {
			if (nextJob >= jobs.length) return
			const index = nextJob++
			const job = { ...jobs[index], id: index }
			/**
			 * @param {MessageEvent<SimJobResult>} event 工作线程消息
			 */
			function onWorkerMessage(event) {
				const msg = event.data
				results[index] = msg
				settled++
				if (settled >= jobs.length) {
					for (const w of workers) w.terminate()
					resolve(results)
					return
				}
				assign(worker)
			}
			/**
			 * @param {ErrorEvent} err Worker 错误
			 */
			function onWorkerError(err) {
				for (const w of workers) w.terminate()
				reject(err)
			}
			worker.onmessage = onWorkerMessage
			worker.onerror = onWorkerError
			worker.postMessage(job)
		}

		for (const worker of workers)
			assign(worker)
	})
}
