/**
 * 两进程真实 P2P：主机 fount + 独立 subfount 客户端，远程 run_code。
 */
/* global Deno */
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { REPO_ROOT } from 'fount/scripts/test/core/repo_root.mjs'
import { launchNode, stopNode } from 'fount/scripts/test/node/launch.mjs'
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

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
		loadParts: ['shells/subfounts'],
		p2p: true,
		captureOutput: true,
	})

	const clientRoot = await Deno.makeTempDir({ prefix: 'fount_subfount_client_' })
	const clientNodeDir = join(clientRoot, 'node')
	const readyFile = join(clientRoot, 'ready.txt')
	const infoFile = join(clientRoot, 'client_info.json')
	await mkdir(clientNodeDir, { recursive: true })

	/** @type {import('node:child_process').ChildProcess | null} */
	let client = null
	/** @type {string} */
	let clientOutput = ''
	try {
		assert(host.p2pRelayUrl, 'host launchNode must expose p2pRelayUrl')

		const fedRes = await p2pFetch(host, 'GET', '/federation')
		const fedRaw = await fedRes.text()
		assertEquals(fedRes.status, 200, fedRaw)
		const hostNodeHash = String(JSON.parse(fedRaw).nodeHash || '').trim().toLowerCase()
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
		})

		client.stdout?.on('data', chunk => { clientOutput += String(chunk) })
		client.stderr?.on('data', chunk => { clientOutput += String(chunk) })

		/** @type {string | null} */
		let clientNodeHash = null
		await waitFor(60_000, async () => {
			const info = await readJsonFile(infoFile)
			clientNodeHash = info?.nodeHash ? String(info.nodeHash).trim().toLowerCase() : null
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
	}
	finally {
		if (client) {
			if (client.exitCode != null && client.exitCode !== 0)
				console.error(`subfount client exited ${client.exitCode}\n${clientOutput}`)
			await stopClient(client)
		}
		await stopNode(host)
		try { await Deno.remove(clientRoot, { recursive: true }) } catch { /* ignore */ }
	}
})
