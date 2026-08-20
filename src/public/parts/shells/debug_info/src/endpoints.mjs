import os from 'node:os'

import { loadNetwork } from 'npm:@steve02081504/fount-p2p/node/network'
import { closeLink, ensureLinkToNode, listLinks } from 'npm:@steve02081504/fount-p2p/transport/link_registry'
import { WebSocket } from 'npm:ws'

import { is_local_ip_from_req } from '../../../../../scripts/ratelimit.mjs'
import { authenticate, getUserByReq } from '../../../../../server/auth/index.mjs'
import { autoUpdateEnabled } from '../../../../../server/autoupdate.mjs'
import { restartor } from '../../../../../server/server.mjs'
import { openEditor } from '../../userSettings/src/editorCommand.mjs'

/** fount test 内核固定端口，见 `src/scripts/test/hub/index.mjs`。 */
const TEST_KERNEL_BASE_URL = 'http://127.0.0.1:8903'
const TEST_KERNEL_WS_URL = 'ws://127.0.0.1:8903/ws/viewer'

/** 内核离线时的占位快照。 */
const KERNEL_OFFLINE = { online: false, active: false, idle: true, runningSuites: [], queuedSuites: [] }

/** 内核离线时后端重探间隔（慢速，保持前端连接不断）。 */
const KERNEL_PROBE_INTERVAL = 10000

/**
 * 竞速等待一个 Promise，超时返回 null。
 * @template T
 * @param {Promise<T>} promise 目标 Promise
 * @param {number} ms 超时毫秒
 * @returns {Promise<T | null>} 结果；超时为 null。
 */
function withTimeout(promise, ms) {
	return Promise.race([
		promise,
		new Promise(resolve => setTimeout(() => resolve(null), ms)),
	])
}

/**
 * 探测 fount P2P 网络连通性：优先复用已活跃的邻居链路；否则主动向已知邻居发起一次
 * 链路握手（`ensureLinkToNode`），成功后随即关闭刚建立的链路避免留驻。
 * @returns {Promise<{ ok: boolean, peersKnown: number, activeLinks: number, peer?: string, error?: string }>} 探测结果
 */
async function probeFountNetwork() {
	try {
		const { trustedPeers, explorePeers } = loadNetwork()
		const candidates = [...new Set([...trustedPeers, ...explorePeers])]
		const existingLinks = listLinks().map(link => link.nodeHash)
		if (existingLinks.length)
			return { ok: true, peersKnown: candidates.length, activeLinks: existingLinks.length, peer: existingLinks[0] }

		for (const hash of candidates.slice(0, 3)) {
			const link = await withTimeout(ensureLinkToNode(hash), 4000)
			if (link) {
				await closeLink(hash, 'debug-connectivity-probe').catch(() => { })
				return { ok: true, peersKnown: candidates.length, activeLinks: 0, peer: hash }
			}
		}
		return { ok: false, peersKnown: candidates.length, activeLinks: 0, error: candidates.length ? 'no neighbor reachable' : 'no peers known' }
	} catch (error) {
		return { ok: false, peersKnown: 0, activeLinks: 0, error: String(error?.message || error) }
	}
}

/**
 * 向客户端推送一次测试内核状态快照。
 * @param {import('npm:ws').WebSocket} ws 客户端连接
 * @returns {Promise<boolean>} 内核是否在线
 */
async function sendKernelSnapshot(ws) {
	let body = KERNEL_OFFLINE
	let online = false
	try {
		const response = await fetch(`${TEST_KERNEL_BASE_URL}/status`, { signal: AbortSignal.timeout(2000) })
		if (response.ok) {
			body = await response.json()
			online = true
		}
	} catch { /* 内核未在跑 */ }
	if (ws.readyState === ws.OPEN)
		ws.send(JSON.stringify({ type: 'snapshot', ...body }))
	return online
}

/**
 * 设置端点。
 * @param {Object} router - Express 路由器。
 */
export function setEndpoints(router) {
	router.get('/api/parts/shells\\:debug_info/auto_update_enabled', authenticate, (req, res) => {
		res.status(200).json({ enabled: autoUpdateEnabled })
	})

	router.post('/api/parts/shells\\:debug_info/restart', authenticate, (req, res) => {
		if (!autoUpdateEnabled) return res.status(403).json({ error: 'auto_update_disabled' })
		res.status(202).json({ status: 'restarting' })
		res.on('finish', () => restartor())
	})

	router.get('/api/parts/shells\\:debug_info/system_info', authenticate, async (req, res) => {
		const checks = [
			{ name: 'npm Registry', url: 'https://registry.npmjs.org' },
			{ name: 'Deno Land', url: 'https://deno.land' },
			{ name: 'jsDelivr', url: 'https://cdn.jsdelivr.net' },
			{ name: 'JSR', url: 'https://jsr.io', method: 'GET' },
			{ name: 'fount Network', kind: 'fount' },
		]

		const checkResults = await Promise.all(checks.map(async (check) => {
			try {
				const start = Date.now()
				const response = check.kind === 'fount'
					? await probeFountNetwork()
					: await fetch(check.url, { method: check.method || 'HEAD', signal: AbortSignal.timeout(5000) })
				const duration = Date.now() - start
				return {
					...check,
					status: response.ok ? 'ok' : 'error',
					duration,
					statusCode: response.status,
					error: response.error,
				}
			} catch (error) {
				return { ...check, status: 'error', error: error.message }
			}
		}))

		const cpus = os.cpus()
		const cpuModel = cpus[0]?.model || 'Unknown'
		const cpuSpeed = cpus[0]?.speed || 0
		const cpuCores = cpus.length

		const info = {
			os: {
				platform: os.platform(),
				release: os.release(),
				arch: os.arch(),
				type: os.type(),
			},
			cpu: {
				model: cpuModel,
				speed: cpuSpeed,
				cores: cpuCores,
			},
			memory: {
				total: os.totalmem(),
				free: os.freemem(),
			},
			connectivity: checkResults,
		}

		res.status(200).json(info)
	})

	router.post('/api/parts/shells\\:debug_info/open_source', authenticate, async (req, res) => {
		const user = getUserByReq(req)
		if (!user) return res.status(401).json({ message: 'Unauthorized' })
		if (!is_local_ip_from_req(req))
			return res.status(403).json({ message: 'Forbidden on non-local request.' })
		const { filePath, line, column } = req.body || {}
		await openEditor(user.username, filePath, line, column)
		res.status(200).json({})
	})

	router.ws('/ws/parts/shells\\:debug_info/test_status', authenticate, (ws, req) => {
		/** @type {import('npm:ws').WebSocket | null} */
		let kernel = null
		/** @type {number | null} */
		let probeTimer = null
		let closed = false

		/**
		 * 建立到测试内核的 viewer 订阅；内核离线或建连失败时返回 false。
		 * @returns {boolean} 是否已连接
		 */
		const openKernelWs = () => {
			if (kernel && kernel.readyState !== WebSocket.CLOSED) return true
			/** @type {import('npm:ws').WebSocket} */
			let candidate
			try {
				candidate = new WebSocket(TEST_KERNEL_WS_URL)
			} catch {
				return false
			}
			kernel = candidate
			candidate.on('open', () => candidate.send(JSON.stringify({ type: 'hello', watch: true })))
			candidate.on('message', data => {
				if (!closed && ws.readyState === ws.OPEN) ws.send(String(data))
			})
			candidate.on('error', () => { try { candidate.close() } catch { /* 已断开 */ } })
			candidate.on('close', () => {
				if (closed || kernel !== candidate) return
				kernel = null
				startKernelProbe()
			})
			return true
		}

		/**
		 * 内核离线时慢速重探：推送快照，恢复上线则重建订阅并停止。
		 * @returns {void}
		 */
		const startKernelProbe = () => {
			if (probeTimer) return
			probeTimer = setInterval(async () => {
				const online = await sendKernelSnapshot(ws)
				if (online && !kernel && openKernelWs()) stopKernelProbe()
			}, KERNEL_PROBE_INTERVAL)
		}

		/**
		 *
		 */
		const stopKernelProbe = () => {
			clearInterval(probeTimer)
			probeTimer = null
		}

		/**
		 *
		 */
		const cleanup = () => {
			closed = true
			stopKernelProbe()
			try { kernel?.close() } catch { /* 已断开 */ }
		}

		ws.on('message', data => {
			if (kernel?.readyState === WebSocket.OPEN) kernel.send(String(data))
		})
		ws.on('close', cleanup)
		ws.on('error', cleanup)

		void sendKernelSnapshot(ws)
		if (!openKernelWs()) startKernelProbe()
	})
}
