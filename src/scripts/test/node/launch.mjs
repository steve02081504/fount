/**
 * 测试用 fount 节点启动工具（编程 API + CLI）。
 */
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { TEST_PORT_BASE } from '../core/ports.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'

const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'worker.mjs')

/**
 * fixture 目录复制条目。
 * @typedef {{ from: string, to: string }} FixtureCopy
 */

/**
 * launchNode 返回的已就绪节点句柄。
 * @typedef {{ baseUrl: string, apiKey: string, username: string, port: number, dataPath: string, process: import('node:child_process').ChildProcess, pid: number }} LaunchedNode
 */

/**
 * 检测本机端口是否可监听。
 * @param {number} port 待检测端口
 * @returns {Promise<boolean>} 127.0.0.1 上是否可监听
 */
function isPortFree(port) {
	return new Promise(resolve => {
		const server = net.createServer()
		server.unref()
		server.on('error', () => resolve(false))
		// 与 fount server.listen(port)（config.listen 为 null）一致，勿只测 127.0.0.1
		server.listen(port, () => {
			server.close(() => resolve(true))
		})
	})
}

/**
 * 绑定端口并保持监听，直到调用方显式 close（消除并行测试 TOCTOU 竞态）。
 * @param {number} port 待持有端口
 * @returns {Promise<import('node:net').Server>} 已监听的 server
 */
function holdPort(port) {
	return new Promise((resolve, reject) => {
		const server = net.createServer()
		server.unref()
		server.on('error', reject)
		server.listen(port, () => resolve(server))
	})
}

/**
 * 关闭 holdPort 返回的 server。
 * @param {import('node:net').Server | undefined} server 待关闭 server
 * @returns {Promise<void>}
 */
async function closeHeldServer(server) {
	if (!server) return
	await new Promise((resolve, reject) => {
		server.close(err => err ? reject(err) : resolve())
	})
}

/**
 * 从首选端口起向上扫描，返回第一个空闲口。
 * @param {number} preferred 首选端口
 * @param {number} [scan=50] 扫描宽度
 * @returns {Promise<number>} 可用端口
 */
export async function pickAvailablePort(preferred, scan = 50) {
	for (let offset = 0; offset < scan; offset++) {
		const port = preferred + offset
		if (await isPortFree(port)) return port
	}
	throw new Error(`no free TCP port from ${preferred} (+${scan})`)
}

/**
 * 已分配并持有的测试端口块。
 * @typedef {object} TestPortBlock
 * @property {number} base 首端口
 * @property {(port: number) => Promise<void>} releasePort 释放单个端口的持有
 * @property {() => Promise<void>} releaseAll 释放整块持有
 */

/**
 * live 双节点端口解析结果。
 * @typedef {object} LiveNodePorts
 * @property {number} nodeAPort 节点 A 端口
 * @property {number} nodeBPort 节点 B 端口
 * @property {(port: number) => Promise<void>} releasePort 释放指定端口持有（env 指定时为空操作）
 */

/** env 指定端口时无持有句柄，释放为空操作。 */
/** @type {(port: number) => Promise<void>} */
const noopReleasePort = async () => {}

/**
 * 由已持有的 server 映射构造端口块句柄。
 * @param {number} base 首端口
 * @param {Map<number, import('node:net').Server>} servers 端口 → 持有 server
 * @returns {TestPortBlock} 释放句柄
 */
function createHeldPortBlock(base, servers) {
	/**
	 * 释放单个端口的持有。
	 * @param {number} port 待释放端口
	 * @returns {Promise<void>}
	 */
	async function releasePort(port) {
		const server = servers.get(port)
		if (!server) return
		servers.delete(port)
		await closeHeldServer(server)
	}

	/**
	 * 释放整块端口持有。
	 * @returns {Promise<void>}
	 */
	async function releaseAll() {
		const closing = [...servers.values()]
		servers.clear()
		await Promise.all(closing.map(closeHeldServer))
	}

	return { base, releasePort, releaseAll }
}

/**
 * 分配连续空闲端口块的首端口，并持有至 releasePort / releaseAll。
 * @param {object} options 选项
 * @param {number} options.count 需要的端口数
 * @param {number} [options.step=2] 步长
 * @param {number} [options.preferred=TEST_PORT_BASE] 首选起始端口
 * @returns {Promise<TestPortBlock>} 首端口与释放句柄
 */
export async function allocateTestPortBlock({ count, step = 2, preferred = TEST_PORT_BASE }) {
	for (let base = preferred; base < preferred + 200; base++) {
		const ports = Array.from({ length: count }, (_, index) => base + index * step)
		/** @type {Map<number, import('node:net').Server>} */
		const servers = new Map()
		let failed = false
		for (const port of ports) try {
			servers.set(port, await holdPort(port))
		}
		catch {
			failed = true
			break
		}

		if (failed) {
			await Promise.all([...servers.values()].map(closeHeldServer))
			continue
		}
		return createHeldPortBlock(base, servers)
	}
	throw new Error(`no free ${count}-port block from ${preferred} step ${step}`)
}

/**
 * 为 live 双节点分配 A/B 端口。
 * @param {object} [options] 选项
 * @param {number} [options.preferred=TEST_PORT_BASE] 节点 A 首选端口
 * @returns {Promise<LiveNodePorts>} 节点 A/B 端口与释放句柄
 */
export async function allocateLiveNodePorts({ preferred = TEST_PORT_BASE } = {}) {
	const { base: nodeAPort, releasePort } = await allocateTestPortBlock({ count: 2, step: 1, preferred })
	return { nodeAPort, nodeBPort: nodeAPort + 1, releasePort }
}

/**
 * live 多节点端口解析结果。
 * @typedef {object} LiveNodeFleet
 * @property {number[]} ports 各节点端口（长度 = count）
 * @property {(port: number) => Promise<void>} releasePort 释放指定端口持有
 */

/**
 * 为 live 联邦套件分配连续 N 个端口（或读 env）。
 * @param {number} [count=2] 节点数
 * @param {NodeJS.ProcessEnv} [env=process.env] 环境变量
 * @returns {Promise<LiveNodeFleet>} 端口列表与释放句柄
 */
export async function resolveLiveNodeFleet(count = 2, env = process.env) {
	const rawCount = env.FOUNT_TEST_NODE_COUNT?.trim()
	const nodeCount = rawCount ? Number(rawCount) : count
	if (!Number.isFinite(nodeCount) || nodeCount < 1)
		throw new Error(`invalid FOUNT_TEST_NODE_COUNT: ${rawCount}`)

	const rawFirst = env.FOUNT_TEST_NODE_1_PORT?.trim()
	if (rawFirst) {
		/** @type {number[]} */
		const ports = []
		for (let i = 0; i < nodeCount; i++) {
			const envKey = `FOUNT_TEST_NODE_${i + 1}_PORT`
			const raw = String(env[envKey] || '').trim()
			if (raw) ports.push(Number(raw))
			else if (i === 0) ports.push(Number(rawFirst))
			else ports.push(await pickAvailablePort(ports[i - 1] + 1))
		}
		return { ports, releasePort: noopReleasePort }
	}

	const { base, releasePort } = await allocateTestPortBlock({ count: nodeCount, step: 1 })
	return {
		ports: Array.from({ length: nodeCount }, (_, index) => base + index),
		releasePort,
	}
}

/**
 * 解析 live 双节点端口：优先读 env，否则分配连续空闲口。
 * @param {NodeJS.ProcessEnv} [env=process.env] 环境变量
 * @returns {Promise<LiveNodePorts>} 节点 A/B 端口与释放句柄
 */
export async function resolveLiveNodePorts(env = process.env) {
	const { ports, releasePort } = await resolveLiveNodeFleet(2, env)
	return { nodeAPort: ports[0], nodeBPort: ports[1], releasePort }
}

/** 端口被其它 fount 实例占用（whoami 用户名不符）。 */
export class PortCollisionError extends Error {
	/**
	 * 构造端口占用冲突错误。
	 * @param {string} baseUrl 节点根 URL
	 * @param {string} expectedUsername 预期用户名
	 * @param {string} actualUsername 实际用户名
	 */
	constructor(baseUrl, expectedUsername, actualUsername) {
		super(
			`port collision on ${baseUrl}: expected user "${expectedUsername}", `
			+ `got "${actualUsername}"`,
		)
		this.name = 'PortCollisionError'
		this.baseUrl = baseUrl
		this.expectedUsername = expectedUsername
		this.actualUsername = actualUsername
	}
}

/**
 * 等待节点 api/ping 返回 pong，且 whoami 用户名与预期一致。
 * @param {string} baseUrl 节点根 URL
 * @param {string} apiKey API key
 * @param {number} [timeoutMs=120000] 超时毫秒
 * @param {string} [expectedUsername] 预期用户名（防端口被其它 fount 实例占用）
 * @returns {Promise<void>} 就绪后 resolve
 */
async function waitForPing(baseUrl, apiKey, timeoutMs = 120_000, expectedUsername = null) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			const ping = await fetch(`${baseUrl}/api/ping?fount-apikey=${encodeURIComponent(apiKey)}`, {
				method: 'GET',
				cache: 'no-store',
			})
			if (!ping.ok || (await ping.json())?.message !== 'pong') {
				await new Promise(resolve => setTimeout(resolve, 500))
				continue
			}
			const whoami = await fetch(`${baseUrl}/api/whoami?fount-apikey=${encodeURIComponent(apiKey)}`, {
				method: 'GET',
				cache: 'no-store',
			})
			if (!whoami.ok) {
				await new Promise(resolve => setTimeout(resolve, 500))
				continue
			}
			if (expectedUsername != null) {
				const username = (await whoami.json())?.username
				if (username !== expectedUsername)
					throw new PortCollisionError(baseUrl, expectedUsername, username ?? '(missing)')
			}
			return
		}
		catch (error) {
			if (error instanceof PortCollisionError) throw error
		}
		await new Promise(resolve => setTimeout(resolve, 500))
	}
	throw new Error(`node not ready within ${timeoutMs}ms: ${baseUrl}`)
}

/**
 * 将 fixture 目录复制到节点用户目录。
 * @param {string} dataPath 节点 data 根目录
 * @param {string} username 目标用户名
 * @param {FixtureCopy[]} copies `to` 相对 users/<username>/
 * @returns {Promise<void>} 复制完成
 */
async function injectFixtures(dataPath, username, copies) {
	if (!copies?.length) return
	for (const { from, to } of copies) {
		const dest = join(dataPath, 'users', username, to)
		await mkdir(dirname(dest), { recursive: true })
		await cp(from, dest, { recursive: true })
	}
}

/**
 * 启动一个 headless fount 测试节点子进程。
 * @param {object} [options={}] 启动选项
 * @param {number} [options.port] 监听端口；省略则从 8931 起扫描空闲口
 * @param {string} [options.dataPath] 数据目录；省略则 mkdtemp
 * @param {string} [options.username='CI-user'] 用户名
 * @param {string} [options.apiKey] API key；省略则按 port 生成
 * @param {FixtureCopy[]} [options.fixtureCopies] 启动前复制到用户目录的 fixture
 * @param {string[]} [options.loadParts] 启动后要 load 的 partpath
 * @param {boolean} [options.p2p=false] 是否启用 P2P 子系统
 * @param {string} [options.bootstrap] bootstrap 模块绝对路径（default export async (username) => void）
 * @param {boolean} [options.keepData=false] stop 时是否保留 data 目录
 * @param {(port: number) => Promise<void>} [options.releasePort] spawn 前释放该端口的持有 server
 * @returns {Promise<LaunchedNode & { keepData: boolean }>} 已就绪节点句柄
 */
export async function launchNode(options = {}) {
	const port = options.port ?? await pickAvailablePort(TEST_PORT_BASE)
	const username = options.username ?? 'CI-user'
	const apiKey = options.apiKey ?? `fount-test-key-${port}`
	const keepData = options.keepData ?? false
	const dataPath = options.dataPath ?? await mkdtemp(join(tmpdir(), `fount_node_${port}_`))

	await injectFixtures(dataPath, username, options.fixtureCopies ?? [])

	const workerArgs = [
		'run', '--allow-all', '-c', join(REPO_ROOT, 'deno.json'),
		workerPath,
		'--data-path', dataPath,
		'--port', String(port),
		'--user', username,
		'--key', apiKey,
	]
	if (options.p2p) workerArgs.push('--p2p')
	for (const part of options.loadParts ?? [])
		workerArgs.push('--load-part', part)
	if (options.bootstrap)
		workerArgs.push('--bootstrap', resolve(options.bootstrap))

	await options.releasePort?.()

	const child = spawn('deno', workerArgs, {
		cwd: REPO_ROOT,
		stdio: ['ignore', 'pipe', 'inherit'],
		env: {
			...process.env,
			FOUNT_TEST: '1',
			FOUNT_DENO_START_TIME: new Date().toISOString(),
		},
	})

	let readyInfo = null
	const readline = createInterface({ input: child.stdout })
	for await (const line of readline) {
		if (!line.trim()) continue
		try {
			const parsed = JSON.parse(line)
			if (parsed?.ready && parsed.baseUrl) {
				readyInfo = parsed
				break
			}
		}
		catch { /* not json yet */ }
	}
	readline.close()
	// 读完 ready JSON 后继续排空 stdout，防止管道缓冲区满导致服务器 event loop 阻塞。
	child.stdout.resume()

	if (!readyInfo?.baseUrl)
		throw new Error(`node worker did not emit ready JSON (port ${port})`)

	await waitForPing(readyInfo.baseUrl, apiKey, 120_000, username)

	return {
		baseUrl: readyInfo.baseUrl,
		apiKey,
		username,
		port,
		dataPath,
		process: child,
		pid: child.pid,
		keepData,
	}
}

/**
 * 终止节点子进程并可选清理 data 目录。
 * @param {LaunchedNode & { keepData?: boolean }} node 由 launchNode 返回的句柄
 * @returns {Promise<void>} 进程已结束
 */
export async function stopNode(node) {
	if (!node?.process) return
	const { process } = node
	process.kill('SIGTERM')
	await Promise.race([
		new Promise(resolve => process.once('close', resolve)),
		new Promise(resolve => setTimeout(resolve, 10_000)),
	])
	if (process.exitCode == null)
		process.kill('SIGKILL')
	await Promise.race([
		new Promise(resolve => process.once('close', resolve)),
		new Promise(resolve => setTimeout(resolve, 5_000)),
	])
	if (!node.keepData && node.dataPath)
		await rm(node.dataPath, { recursive: true, force: true })
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			port: { type: 'string' },
			data: { type: 'string' },
			user: { type: 'string', default: 'CI-user' },
			key: { type: 'string' },
			p2p: { type: 'boolean', default: false },
			bootstrap: { type: 'string' },
			'load-part': { type: 'string', multiple: true },
		},
	})

	const node = await launchNode({
		...values.port ? { port: Number(values.port) } : {},
		dataPath: values.data,
		username: values.user,
		apiKey: values.key,
		p2p: values.p2p,
		bootstrap: values.bootstrap,
		loadParts: values['load-part'] ?? [],
		keepData: true,
	})

	console.log(JSON.stringify({
		baseUrl: node.baseUrl,
		apiKey: node.apiKey,
		username: node.username,
		port: node.port,
		dataPath: node.dataPath,
		pid: node.pid,
	}))

	/**
	 * CLI 模式下清理节点并退出。
	 */
	const onExit = async () => {
		await stopNode({ ...node, keepData: true })
		process.exit(0)
	}
	process.on('SIGINT', onExit)
	process.on('SIGTERM', onExit)
	await new Promise(resolve => node.process.once('close', resolve))
}
