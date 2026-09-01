/**
 * 测试内核 HTTP + viewer WS：吞掉 hub，加上任务 / 模组检查 / 调度。
 */
import process from 'node:process'

import express from 'npm:express'
import { WebSocketServer } from 'npm:ws'

import { REPO_ROOT } from '../core/repo_root.mjs'
import { resolveDisplayMode } from '../display/mode.mjs'
import { createGithubIssueRouter } from '../hub/apis/github_issue.mjs'
import { createHealthRouter } from '../hub/apis/health.mjs'
import { createSharedStoreRouter } from '../hub/apis/shared_store.mjs'
import { TEST_HUB_PORT, testHubUrl } from '../hub/index.mjs'

import { TestKernel } from './runtime.mjs'

/**
 * 启动测试内核（独占端口；EADDRINUSE 抛错给调用方）。
 * @param {object} [options] 选项
 * @param {number} [options.port] 端口
 * @param {string} [options.repoRoot] 仓库根
 * @param {boolean} [options.autoExit] 空闲且无 watch 时退出
 * @param {boolean} [options.watchFs] 是否监视文件系统
 * @param {number} [options.prepSettleMs] 预备静置毫秒
 * @param {boolean} [options.writeReport] 是否写活报告
 * @param {number} [options.moduleCheckHoldTimeoutMs] 模组检查持有超时
	 * @param {number} [options.idleAllMs] watch 闲置自动补跑 --all 的静置毫秒
	 * @param {boolean} [options.autoUpdateExpected] 跑完是否按漂移自动回写 manifest `expected`
	 * @param {number} [options.idleExitGraceMs] 空闲且无 watcher 后自动退出的宽限毫秒
	 * @param {(name: string) => void} [options.onPhase] 启动相位回调（bench 工具）
	 * @returns {Promise<{ url: string, kernel: TestKernel, close: () => Promise<void> }>} 句柄
	 */
export async function startTestKernel({
	port = TEST_HUB_PORT,
	repoRoot = REPO_ROOT,
	autoExit = false,
	watchFs = true,
	prepSettleMs,
	writeReport = true,
	moduleCheckHoldTimeoutMs,
	idleAllMs,
	autoUpdateExpected,
	idleExitGraceMs,
	onPhase = () => { },
} = {}) {
	const kernel = new TestKernel({ repoRoot, autoExit, watchFs, prepSettleMs, writeReport, moduleCheckHoldTimeoutMs, idleAllMs, autoUpdateExpected, idleExitGraceMs })
	onPhase('kernelConstructed')
	await kernel.start(onPhase)

	const app = express()
	app.use((request, response, next) => {
		response.setHeader('Access-Control-Allow-Origin', '*')
		response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
		response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
		if (request.method === 'OPTIONS') return response.sendStatus(204)
		next()
	})
	app.use(express.json({ limit: '4mb' }))
	app.use(createHealthRouter({ kernel: true }))
	app.use(createGithubIssueRouter(kernel.issueCache))
	app.use(createSharedStoreRouter())

	app.get('/status', (request, response) => {
		response.json({ ...kernel.statusSnapshot(), online: true })
	})

	app.post('/module-check/acquire', async (request, response) => {
		const abort = new AbortController()
		/** 客户端断开且尚未写出响应时取消等待。 */
		const onDisconnect = () => {
			if (!response.writableEnded) abort.abort()
		}
		response.on('close', onDisconnect)
		/** @type {string | null} */
		let ticket = null
		try {
			ticket = await kernel.moduleCheck.acquire(abort.signal)
			if (!response.writable || response.destroyed || response.writableEnded) {
				kernel.moduleCheck.consumeMissedReady(ticket)
				return
			}
			response.json({ ticket })
		}
		catch (error) {
			if (ticket) kernel.moduleCheck.consumeMissedReady(ticket)
			if (abort.signal.aborted || error?.name === 'AbortError') {
				if (!response.headersSent) response.status(499).end()
				return
			}
			throw error
		}
		finally {
			response.off('close', onDisconnect)
		}
	})
	app.post('/module-check/ready', (request, response) => {
		const ticket = String(request.body?.ticket || '')
		const durationMs = kernel.moduleCheck.ready(ticket)
		kernel.markModuleCheckDone(ticket)
		response.json({ ok: durationMs != null, durationMs })
	})
	app.post('/module-check/abandon', (request, response) => {
		const ticket = String(request.body?.ticket || '')
		response.json({ missed: kernel.moduleCheck.consumeMissedReady(ticket) })
	})
	app.post('/shutdown', (request, response) => {
		if (request.headers.origin) return void response.sendStatus(403)
		response.json({ ok: true })
		/** 响应发出后再关，避免和当前请求互相等待。 */
		const go = () => { void kernel.close() }
		if (response.writableEnded) queueMicrotask(go)
		else response.once('finish', go)
	})
	onPhase('expressReady')

	let server
	try {
		server = await new Promise((resolve, reject) => {
			const httpServer = app.listen({ port, host: '127.0.0.1', exclusive: true })
			httpServer.once('error', reject)
			httpServer.once('listening', () => {
				if (!httpServer.address()) {
					reject(Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }))
					return
				}
				resolve(httpServer)
			})
		})
	}
	catch (error) {
		await kernel.close()
		throw error
	}
	onPhase('listening')

	const webSocketServer = new WebSocketServer({ server, path: '/ws/viewer' })
	onPhase('wsReady')
	webSocketServer.on('connection', (socket) => {
		const viewer = kernel.viewers.add(socket, { watch: false, mode: 'overview' })
		kernel.resetIdleExitGrace()
		socket.on('message', rawMessage => {
			void onViewerMessage(kernel, viewer, rawMessage)
		})
		socket.on('close', () => {
			kernel.viewers.remove(viewer.id)
			kernel.dropViewer(viewer.id)
		})
	})

	const previousHub = process.env.FOUNT_TEST_HUB_URL
	process.env.FOUNT_TEST_HUB_URL = testHubUrl(port)

	let closed = false
	/**
	 * @returns {Promise<void>}
	 */
	const close = async () => {
		if (closed) return
		closed = true
		for (const client of webSocketServer.clients)
			client.close()
		webSocketServer.close()
		await kernel.close()
		await new Promise((resolve, reject) => {
			server.close(err => err ? reject(err) : resolve())
		})
		if (previousHub === undefined) delete process.env.FOUNT_TEST_HUB_URL
		else process.env.FOUNT_TEST_HUB_URL = previousHub
	}
	/** HTTP 随内核退出一起停。 */
	kernel.onClose = () => {
		if (!closed) void close()
	}

	return {
		url: testHubUrl(port),
		kernel,
		close,
		closed: kernel.waitClosed().then(() => close()),
	}
}

/**
 * @param {TestKernel} kernel 内核
 * @param {import('./viewers.mjs').Viewer} viewer viewer
 * @param {import('node:buffer').Buffer | string} rawMessage 消息
 * @returns {Promise<void>}
 */
async function onViewerMessage(kernel, viewer, rawMessage) {
	let message
	try {
		message = JSON.parse(String(rawMessage))
	}
	catch {
		return
	}
	if (message.type && message.type !== 'hello') return
	viewer.watch = message.watch === true
	if (viewer.watch || !message.job) {
		viewer.mode = 'overview'
		kernel.viewers.send(viewer.id, {
			type: 'accepted',
			viewerId: viewer.id,
			jobId: null,
			runCount: 0,
			mode: viewer.mode,
		})
		kernel.wake()
		return
	}
	const submitted = await kernel.submitJob(message.job, viewer.id)
	viewer.jobId = submitted.jobId
	viewer.mode = resolveDisplayMode({ watch: false, job: message.job, runCount: submitted.runCount })
	kernel.viewers.send(viewer.id, {
		type: 'accepted',
		viewerId: viewer.id,
		mode: viewer.mode,
		...submitted,
	})
	if (kernel.jobs.has(submitted.jobId))
		await kernel.releaseJob(submitted.jobId)
	else
		kernel.viewers.send(viewer.id, {
			type: 'job-done',
			jobId: submitted.jobId,
			exitCode: submitted.code ?? 0,
			reportPath: submitted.reportPath,
			allReusedHint: submitted.allReusedHint,
		})
}
