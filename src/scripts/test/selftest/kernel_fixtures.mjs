/**
 * 内核自测共用：skip dummy、入队等待、假 job。
 */
import { parseSkipBecause } from '../core/skip_because.mjs'

/** 避开生产 8903 与 hub 自测 18903。 */
export const KERNEL_PORT = 18904
export const SKIP_URL = 'https://github.com/denoland/deno/issues/35804'

/**
 * @returns {Promise<{ closed: boolean, closedAt: number | null }>} 视为未关
 */
export async function issueStillOpen() {
	return { closed: false, closedAt: null }
}

/**
 * @returns {Promise<{ closed: boolean, closedAt: number | null }>} 视为已关（epoch，delay 0 立即过期）
 */
export async function issueClosed() {
	return { closed: true, closedAt: 0 }
}

/**
 * @param {string} name dummy suite 名
 * @param {unknown} skipBecause skip_because 原始字段
 * @returns {object} suite
 */
export function dummySkipSuite(name, skipBecause) {
	return {
		manifestId: 'testkit',
		name,
		skipBecause: parseSkipBecause(skipBecause, `suite "${name}"`),
		run: ['true'],
		triggers: [],
		dependencies: [],
		heavy: false,
	}
}

/**
 * 挂一个假 viewer 并入队 CLI job。
 * @param {import('../kernel/runtime.mjs').TestKernel} kernel 内核
 * @param {object} spec 项
 * @param {string} spec.key suite 键
 * @param {string} spec.jobId job
 * @param {string} [spec.endKey] 捕获的 suite-end 键
 * @returns {{ job: object, end: () => object | null }} job 与结束事件
 */
export function enqueueDummyJob(kernel, { key, jobId, endKey = key }) {
	/** @type {object | null} */
	let end = null
	kernel.viewers.add({
		readyState: 1,
		/**
		 * @param {string} raw 事件 JSON
		 * @returns {void}
		 */
		send: raw => {
			const message = JSON.parse(raw)
			if (message.type === 'suite-end' && message.key === endKey) end = message
		},
	}, { mode: 'overview' })
	const item = kernel.queues.enqueueCli({ key, viewerId: 'v', jobId })
	const job = {
		id: jobId,
		viewerId: 'v',
		spec: {},
		pending: new Set([item.id]),
		probedSkip: new Set(),
		continueLoop: false,
		exitCode: 0,
		done: Promise.withResolvers(),
		fingerprints: { commitHash: null, uncommittedHash: null },
	}
	kernel.jobs.set(job.id, job)
	return { job, end: () => end }
}

/**
 * @param {object} job job
 * @param {string} timeoutMessage 超时文案
 * @param {number} [timeoutMs] 超时
 * @returns {Promise<void>}
 */
export async function awaitJob(job, timeoutMessage, timeoutMs = 8000) {
	await Promise.race([
		job.done.promise,
		new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)),
	])
}

/**
 * @param {import('../kernel/runtime.mjs').TestKernel} kernel 内核
 * @param {object} suite dummy suite
 * @param {string} jobId job
 * @returns {Promise<{ end: object | null, job: object }>} 结束事件与 job
 */
export async function enqueueAndAwaitSkip(kernel, suite, jobId) {
	const key = `${suite.manifestId}:${suite.name}`
	kernel.catalog.allSuites.push(suite)
	kernel.catalog.byKey.set(key, suite)
	const { job, end } = enqueueDummyJob(kernel, { key, jobId })
	kernel.wake()
	await job.done.promise
	return { end: end(), job }
}
