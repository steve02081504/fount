/**
 * 两进程真实 P2P：主机 fount + 独立 subfount 客户端，远程 run_code。
 */
/* global Deno */
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from 'fount/scripts/test/core/repo_root.mjs'
import { launchNode, stopNode } from 'fount/scripts/test/node/launch.mjs'

import { remoteShellStopScript, remoteShellStreamScript } from '../../../../plugins/file-operations/src/remote_stream.mjs'

import { subfountFetch } from './helpers/subfount_http.mjs'

const integrationDir = dirname(fileURLToPath(import.meta.url))
const clientWorkerPath = join(integrationDir, 'helpers/subfount_client_worker.mjs')

/**
 * @param {object} node 主机节点
 * @param {string} method HTTP 方法
 * @param {string} path P2P API 路径
 * @param {object} [body] JSON body
 * @returns {Promise<Response>} fetch Response
 */
function p2pFetch(node, method, path, body) {
	const sep = path.includes('?') ? '&' : '?'
	const url = `${node.baseUrl}/api/p2p${path}${sep}fount-apikey=${encodeURIComponent(node.apiKey)}`
	return fetch(url, {
		method,
		headers: body ? { 'content-type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	})
}

/**
 * @param {number} timeoutMs 超时毫秒
 * @param {() => Promise<boolean>} predicate 条件
 * @returns {Promise<void>} 条件成立返回；超时抛错
 */
async function waitFor(timeoutMs, predicate) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await predicate()) return
		await new Promise(resolve => setTimeout(resolve, 1000))
	}
	throw new Error(`waitFor timed out after ${timeoutMs}ms`)
}

/**
 * @param {object} options 客户端参数
 * @returns {import('node:child_process').ChildProcess} 子进程
 */
function spawnSubfountClient(options) {
	const denoBin = Deno.execPath()
	return spawn(denoBin, [
		'run', '--allow-scripts', '--allow-all',
		'-c', join(REPO_ROOT, 'deno.json'),
		clientWorkerPath,
	], {
		cwd: REPO_ROOT,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...Deno.env.toObject(),
			FOUNT_TEST_P2P_RELAY_URL: options.relayUrl,
			FOUNT_TEST_SUBFOUNT_HOST_PEER_ID: options.hostPeerId,
			FOUNT_TEST_SUBFOUNT_HOST_NODE_HASH: options.hostNodeHash,
			FOUNT_TEST_SUBFOUNT_PASSWORD: options.password,
			FOUNT_TEST_SUBFOUNT_NODE_DIR: options.nodeDir,
			FOUNT_TEST_SUBFOUNT_INFO_FILE: options.infoFile,
			FOUNT_TEST_SUBFOUNT_READY_FILE: options.readyFile,
			FOUNT_TEST_SUBFOUNT_STAGE_FILE: options.stageFile,
		},
	})
}

/**
 * @param {import('node:child_process').ChildProcess} child 子进程
 * @returns {Promise<void>} 无
 */
async function stopClient(child) {
	if (!child?.pid) return
	child.kill('SIGTERM')
	await Promise.race([
		new Promise(resolve => child.once('exit', resolve)),
		new Promise(resolve => setTimeout(resolve, 10_000)),
	])
	if (child.exitCode == null) child.kill('SIGKILL')
}

/**
 * @param {object} node 主机节点
 * @returns {Promise<object>} 已连接的远程分机
 */
async function waitForRemoteSubfount(node) {
	/** @type {object | null} */
	let remote = null
	await waitFor(120_000, async () => {
		const res = await subfountFetch(node, 'GET', '/connected')
		if (!res.ok) return false
		const body = await res.json()
		remote = (body.subfounts || []).find(s => s.id > 0 && s.isConnected) || null
		return !!remote
	})
	return remote
}

/**
 * @param {string} path 文件路径
 * @returns {Promise<object | null>} 解析后的 JSON；失败为 null
 */
async function readJsonFile(path) {
	try {
		return JSON.parse(await Deno.readTextFile(path))
	}
	catch {
		return null
	}
}

Deno.test({
	name: 'remote execute over real P2P link (host + client process)',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const apiKey = `fount-subfounts-remote-${Date.now().toString(36)}`
	const host = await launchNode({
		username: 'subfounts-remote-host',
		apiKey,
		loadParts: ['shells/subfounts', 'shells/code'],
		p2p: true,
		captureOutput: true,
	})

	const clientRoot = await Deno.makeTempDir({ prefix: 'fount_subfount_client_' })
	const clientNodeDir = join(clientRoot, 'node')
	const remoteWorkspace = join(clientRoot, 'workspace')
	const readyFile = join(clientRoot, 'ready.txt')
	const infoFile = join(clientRoot, 'client_info.json')
	const stageFile = join(clientRoot, 'stage.txt')
	await mkdir(clientNodeDir, { recursive: true })
	await mkdir(remoteWorkspace, { recursive: true })

	/** @type {import('node:child_process').ChildProcess | null} */
	let client = null
	/** @type {string} */
	let clientOutput = ''
	let watchSocket
	try {
		assert(host.p2pRelayUrl, 'host launchNode must expose p2pRelayUrl')

		const fedRes = await p2pFetch(host, 'GET', '/federation')
		const fedRaw = await fedRes.text()
		assertEquals(fedRes.status, 200, fedRaw)
		const hostNodeHash = String(JSON.parse(fedRaw).nodeHash || '').trim()
		assert(hostNodeHash, 'host nodeHash missing')

		const codeRes = await subfountFetch(host, 'GET', '/connection-code')
		const codeRaw = await codeRes.text()
		assertEquals(codeRes.status, 200, codeRaw)
		const { peerId, password } = JSON.parse(codeRaw)

		// initRoom 在 getUserManager 内异步启动，给 scope room 一点时间完成 start()
		await new Promise(resolve => setTimeout(resolve, 3000))

		client = spawnSubfountClient({
			relayUrl: host.p2pRelayUrl,
			hostPeerId: peerId,
			hostNodeHash,
			password,
			nodeDir: clientNodeDir,
			infoFile,
			readyFile,
			stageFile,
		})

		client.stdout?.on('data', chunk => { clientOutput += String(chunk) })
		client.stderr?.on('data', chunk => { clientOutput += String(chunk) })

		/** @type {string | null} */
		let clientNodeHash = null
		await waitFor(60_000, async () => {
			const info = await readJsonFile(infoFile)
			clientNodeHash = info?.nodeHash ? String(info.nodeHash).trim() : null
			return !!clientNodeHash
		})

		const connectRes = await p2pFetch(host, 'POST', '/federation/connect-node', {
			targetNodeHash: clientNodeHash,
		})
		const connectRaw = await connectRes.text()
		assertEquals(connectRes.status, 200, connectRaw)

		await waitFor(120_000, async () => {
			try {
				const text = await Deno.readTextFile(readyFile)
				return text.trim() === 'ok'
			}
			catch {
				return false
			}
		}).catch(async error => {
			let stage = ''
			try { stage = await Deno.readTextFile(stageFile) } catch { /* ignore */ }
			throw new Error(`${error.message}\n--- stage ---\n${stage}\n--- host log ---\n${host.takeOutput()}\n--- client log ---\n${clientOutput}`)
		})

		const remote = await waitForRemoteSubfount(host)
		assert(remote?.id > 0, 'remote subfount id missing')

		const execRes = await subfountFetch(host, 'POST', '/execute', {
			subfountId: remote.id,
			script: '6 * 7',
		})
		const execRaw = await execRes.text()
		assertEquals(execRes.status, 200, `${execRaw}\n--- host log ---\n${host.takeOutput()}\n--- client log ---\n${clientOutput}`)
		const execBody = JSON.parse(execRaw)
		assertEquals(execBody.result?.result, 42)

		// 远程自动更新：浏览器 WS → 主机通用会话 → 独立分机文件监听 → 回传事件。
		const frames = []
		watchSocket = new WebSocket(`${host.baseUrl.replace(/^http/, 'ws')}/ws/parts/shells:code/workspace/watch?fount-apikey=${encodeURIComponent(host.apiKey)}`)
		/**
		 * 处理测试会话消息。
		 * @param {MessageEvent} event 回调参数。
		 * @returns {any} 操作结果。
		 */
		watchSocket.onmessage = event => frames.push(JSON.parse(event.data))
		await waitFor(10000, async () => watchSocket.readyState === WebSocket.OPEN)
		watchSocket.send(JSON.stringify({ machine: String(remote.id), workdir: remoteWorkspace, paths: [''] }))
		await waitFor(15000, async () => frames.some(frame => frame.type === 'ready'))
		const write = await subfountFetch(host, 'POST', '/execute', {
			subfountId: remote.id,
			script: `const fs = await import('node:fs/promises'); await fs.writeFile(${JSON.stringify(join(remoteWorkspace, 'remote-note.txt'))}, 'changed'); return true`,
		})
		assertEquals(write.status, 200)
		await write.arrayBuffer()
		await waitFor(10000, async () => frames.some(frame => frame.type === 'change'))
		watchSocket.close()
		await waitFor(10000, async () => {
			const removed = await subfountFetch(host, 'POST', '/execute', {
				subfountId: remote.id,
				script: `const fs = await import('node:fs/promises'); try { await fs.rm(${JSON.stringify(remoteWorkspace)}, { recursive: true, force: true }); return true } catch { return false }`,
			})
			return (await removed.json()).result?.result === true
		})
		await mkdir(remoteWorkspace, { recursive: true })
		const resumedFrames = []
		watchSocket = new WebSocket(`${host.baseUrl.replace(/^http/, 'ws')}/ws/parts/shells:code/workspace/watch?fount-apikey=${encodeURIComponent(host.apiKey)}`)
		/**
		 * 收集重新订阅的远程工作区帧。
		 * @param {MessageEvent} event 服务端消息。
		 * @returns {number} 已收集的帧数。
		 */
		watchSocket.onmessage = event => resumedFrames.push(JSON.parse(event.data))
		await waitFor(10000, async () => watchSocket.readyState === WebSocket.OPEN)
		watchSocket.send(JSON.stringify({ machine: String(remote.id), workdir: remoteWorkspace, paths: [''] }))
		await waitFor(15000, async () => resumedFrames.some(frame => frame.type === 'ready'))

		// A second RPC must be able to cancel an in-flight run_code on the same peer.
		const executionId = crypto.randomUUID()
		const remoteShell = Deno.build.os === 'windows' ? 'powershell' : 'sh'
		const command = remoteShell === 'sh' ? 'sleep 30' : 'Start-Sleep -Seconds 30'
		const running = subfountFetch(host, 'POST', '/execute', {
			subfountId: remote.id,
			script: remoteShellStreamScript(remoteShell, command, undefined, 15000, executionId, true),
		})
		try {
			await waitFor(10000, async () => {
				const stopped = await subfountFetch(host, 'POST', '/execute', {
					subfountId: remote.id, script: remoteShellStopScript(executionId),
				})
				assertEquals(stopped.status, 200)
				return (await stopped.json()).result?.result === true
			})
			const stoppedRun = await running
			assertEquals(stoppedRun.status, 200)
			const stoppedBody = (await stoppedRun.json()).result
			assert(stoppedBody.error || stoppedBody.result?.code || stoppedBody.result?.signal)
			const stale = await subfountFetch(host, 'POST', '/execute', {
				subfountId: remote.id, script: remoteShellStopScript(executionId),
			})
			assertEquals((await stale.json()).result?.result, false)
		} finally {
			await subfountFetch(host, 'POST', '/execute', {
				subfountId: remote.id, script: remoteShellStopScript(executionId),
			}).then(response => response.arrayBuffer())
			await running
		}
		await stopClient(client)
		client = null
		await waitFor(40000, async () => resumedFrames.some(frame => frame.type === 'disconnected'))
		assert(resumedFrames.some(frame => ['disconnected', 'cancelled', 'heartbeat-timeout'].includes(frame.reason)))
	}
	finally {
		watchSocket?.close()
		if (client) {
			if (client.exitCode != null && client.exitCode !== 0)
				console.error(`subfount client exited ${client.exitCode}\n${clientOutput}`)
			await stopClient(client)
		}
		await stopNode(host)
		try { await Deno.remove(clientRoot, { recursive: true }) } catch { /* ignore */ }
	}
})
