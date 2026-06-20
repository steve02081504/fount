/**
 * 仿真任务 Worker 池：常驻 Worker 跨评估复用。
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
 * @typedef {{
 *   worker: Worker,
 *   busy: boolean,
 * }} PoolSlot
 */

/** @type {PoolSlot[] | null} */
let poolSlots = null

const workerUrl = new URL('./sim_worker.mjs', import.meta.url)

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
 * 按曾请求过的最大并发度扩容常驻 Worker 池。
 * @param {number} size 本次请求并发度
 * @returns {PoolSlot[] | null} 池槽位；无 Worker 环境时 null
 */
function ensurePool(size) {
	if (typeof Worker === 'undefined') return null
	const target = Math.max(1, size)
	if (!poolSlots) poolSlots = []
	while (poolSlots.length < target)
		poolSlots.push({ worker: new Worker(workerUrl, { type: 'module' }), busy: false })
	return poolSlots
}

/**
 * 终止所有常驻 Worker 并清空池（CLI / 测试收尾时调用）。
 * @returns {void}
 */
export function shutdownSimPool() {
	if (!poolSlots) return
	for (const slot of poolSlots) slot.worker.terminate()
	poolSlots = null
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

	const slots = ensurePool(concurrency)
	if (!slots) return jobs.map(runJobLocal)

	const activeCount = Math.min(concurrency, jobs.length, slots.length)
	/** @type {PoolSlot[]} */
	const batchSlots = slots.slice(0, activeCount)

	/** @type {SimJobResult[]} */
	const results = new Array(jobs.length)
	let nextJob = 0
	let settled = 0
	let failed = false

	return new Promise((resolve, reject) => {
		/**
		 * @param {number} slotIndex 槽位下标
		 * @returns {void}
		 */
		function dispatch(slotIndex) {
			if (failed || nextJob >= jobs.length) return
			const slot = batchSlots[slotIndex]
			if (slot.busy) return

			const index = nextJob++
			const job = { ...jobs[index], id: index }
			slot.busy = true

			/**
			 * @param {MessageEvent<SimJobResult>} event 工作线程消息
			 */
			function onWorkerMessage(event) {
				results[index] = event.data
				settled++
				slot.busy = false
				slot.worker.onmessage = null
				slot.worker.onerror = null

				if (settled >= jobs.length) {
					resolve(results)
					return
				}
				for (let i = 0; i < batchSlots.length; i++) dispatch(i)
			}

			/**
			 * @param {ErrorEvent} err Worker 错误
			 */
			function onWorkerError(err) {
				failed = true
				reject(err)
			}

			slot.worker.onmessage = onWorkerMessage
			slot.worker.onerror = onWorkerError
			slot.worker.postMessage(job)
		}

		for (let i = 0; i < activeCount; i++) dispatch(i)
	})
}
