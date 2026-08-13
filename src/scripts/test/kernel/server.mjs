/**
 * 测试内核 HTTP + viewer WS：吞掉 hub，加上任务 / 模组检查 / 调度。
 */
import process from 'node:process'

import express from 'npm:express'
import { WebSocketServer } from 'npm:ws'

import { REPO_ROOT } from '../core/repo_root.mjs'
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
 * @returns {Promise<{ url: string, kernel: TestKernel, close: () => Promise<void> }>} 句柄
 */
export async function startTestKernel({
	port = TEST_HUB_PORT,
	repoRoot = REPO_ROOT,
	autoExit = false,
	watchFs = true,
	prepSettleMs,
	writeReport = true,
} = {}) {
	const kernel = new TestKernel({ repoRoot, autoExit, watchFs, prepSettleMs, writeReport })
	await kernel.start()

	const app = express()
	app.use((req, res, next) => {
		res.setHeader('Access-Control-Allow-Origin', '*')
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
		if (req.method === 'OPTIONS') return res.sendStatus(204)
		next()
	})
	app.use(express.json({ limit: '4mb' }))
	app.use(createHealthRouter())
	app.use(createGithubIssueRouter(kernel.issueCache))
	app.use(createSharedStoreRouter())

	app.post('/module-check/acquire', async (req, res) => {
		const ticket = await kernel.moduleCheck.acquire()
		res.json({ ticket })
	})
	app.post('/module-check/ready', (req, res) => {
		const ticket = String(req.body?.ticket || '')
		const durationMs = kernel.moduleCheck.ready(ticket)
		res.json({ ok: durationMs != null, durationMs })
	})

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

	const wss = new WebSocketServer({ server, path: '/ws/viewer' })
	wss.on('connection', (ws) => {
		const viewer = kernel.viewers.add(ws, { watch: false, mode: 'overview' })
		ws.on('message', raw => {
			void onViewerMessage(kernel, viewer, raw)
		})
		ws.on('close', () => {
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
		for (const client of wss.clients)
			client.close()
		wss.close()
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
 * @param {import('node:buffer').Buffer | string} raw 消息
 * @returns {Promise<void>}
 */
async function onViewerMessage(kernel, viewer, raw) {
	let msg
	try {
		msg = JSON.parse(String(raw))
	}
	catch {
		return
	}
	if (msg.type && msg.type !== 'hello') return
	viewer.watch = msg.watch === true
	viewer.mode = msg.watch || !msg.job ? 'overview' : msg.mode || 'overview'
	kernel.seenViewer = true
	if (msg.watch || !msg.job) {
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
	const submitted = await kernel.submitJob(msg.job, viewer.id)
	viewer.jobId = submitted.jobId
	if (submitted.runCount === 1) viewer.mode = 'stream'
	else if (submitted.runCount > 1) viewer.mode = 'multi'
	else viewer.mode = msg.mode || 'overview'
	kernel.viewers.send(viewer.id, {
		type: 'accepted',
		viewerId: viewer.id,
		jobId: submitted.jobId,
		mode: viewer.mode,
		runCount: submitted.runCount,
		reuseCount: submitted.reuseCount,
		blockedCount: submitted.blockedCount,
		code: submitted.code,
		empty: submitted.empty,
		error: submitted.error,
		selectionMode: submitted.selectionMode,
		goalCount: submitted.goalCount,
		total: submitted.total,
		noisyKeys: submitted.noisyKeys,
		deadTriggers: submitted.deadTriggers,
		unmatched: submitted.unmatched,
		unknownSuites: submitted.unknownSuites,
		filterErrors: submitted.filterErrors,
		knownIds: submitted.knownIds,
		available: submitted.available,
		reportPath: submitted.reportPath,
	})
	if (submitted.runCount === 0)
		kernel.viewers.send(viewer.id, {
			type: 'job-done',
			jobId: submitted.jobId,
			exitCode: submitted.code ?? 0,
			reportPath: submitted.reportPath,
			allReusedHint: submitted.allReusedHint,
		})
}
