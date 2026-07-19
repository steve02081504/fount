/**
 * 测试用 fount 节点启动工具（编程 API + CLI）。
 */
/* global Deno */
import 'fount/scripts/test/env.mjs'

import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { console } from '../../i18n/bare.mjs'
import { ms } from '../../ms.mjs'
import { closeHeldServers, holdListenPort, isListenPortFree } from '../../net_listen.mjs'
import { assertDisposableDataPath } from '../core/disposable_path.mjs'
import { parseArgsOrExit } from '../core/parse_args_or_exit.mjs'
import { heapSnapshotDir } from '../core/paths.mjs'
import { TEST_PORT_BASE } from '../core/ports.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import { buildV8FlagsArg, collectHeapSnapshots } from '../heap_snapshot.mjs'
import { startTestNostrRelay, stopTestNostrRelay } from '../live/nostr_relay.mjs'
import { appendBoundedTail } from '../runner/run_command.mjs'

import { defaultTestStarts } from './starts.mjs'

const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'worker.mjs')

/** 测试节点默认 V8 老生代上限（MB）；0 表示不限制。 */
const DEFAULT_TEST_NODE_HEAP_MB = 1024

/**
 * 解析测试节点 V8 堆上限（MB）；0 表示不注入 --max-old-space-size。
 * @returns {number} 堆上限 MB
 */
function resolveTestNodeHeapMb() {
	const raw = process.env.FOUNT_TEST_NODE_HEAP_MB
	if (raw === '' || raw === '0') return 0
	const parsed = Number(raw)
	if (Number.isFinite(parsed) && parsed > 0) return parsed
	return DEFAULT_TEST_NODE_HEAP_MB
}

/**
 * 构造 deno run 的 --v8-flags 参数（堆上限；近 OOM 快照由 worker 内 env.mjs 调用 v8 API 启用）。
 * @returns {string | null} --v8-flags=... 或 null
 */
function buildTestNodeV8FlagsArg() {
	/** @type {string[]} */
	const flags = []
	const heapMb = resolveTestNodeHeapMb()
	if (heapMb > 0) flags.push(`--max-old-space-size=${heapMb}`)
	return buildV8FlagsArg(flags)
}

/**
 * 回收子进程在仓库根目录产出的堆快照，并打印绝对路径。
 * @param {number} pid 子进程 pid
 * @returns {Promise<string[]>} 已搬运的快照绝对路径
 */
async function collectNodeHeapSnapshots(pid) {
	const saved = await collectHeapSnapshots({
		pid,
		destDir: heapSnapshotDir(REPO_ROOT),
		cwd: REPO_ROOT,
	})
	for (const dest of saved)
		console.warnI18n('fountConsole.test.heapSnapshotSaved', { path: dest })
	return saved
}

/**
 * fixture 目录复制条目。
 * @typedef {{ from: string, to: string }} FixtureCopy
 */

/**
 * launchNode 返回的已就绪节点句柄。
 * @typedef {{ baseUrl: string, apiKey: string, username: string, port: number, dataPath: string, process: import('node:child_process').ChildProcess, pid: number, usedTestRelay?: boolean, p2pRelayUrl?: string, peekOutput: () => string, takeOutput: () => string }} LaunchedNode
 */

/**
 * 检测本机端口是否可监听（默认双栈）。
 * @param {number} port 待检测端口
 * @returns {Promise<boolean>} 是否可监听
 */
function isPortFree(port) {
	return isListenPortFree(port)
}

/**
 * 绑定端口并保持监听，直到调用方显式 close（消除并行测试 TOCTOU 竞态）。
 * @param {number} port 待持有端口
 * @returns {Promise<import('node:net').Server[]>} 已监听的 server 列表
 */
function holdPort(port) {
	return holdListenPort(port)
}

/**
 * 关闭 holdPort 返回的 server 列表。
 * @param {import('node:net').Server[] | undefined} servers 待关闭 server
 * @returns {Promise<void>}
 */
function closeHeldServer(servers) {
	return closeHeldServers(servers)
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
 * @param {Map<number, import('node:net').Server[]>} servers 端口 → 持有 server 列表
 * @returns {TestPortBlock} 释放句柄
 */
function createHeldPortBlock(base, servers) {
	/**
	 * 释放单个端口的持有。
	 * @param {number} port 待释放端口
	 * @returns {Promise<void>}
	 */
	async function releasePort(port) {
		const serversForPort = servers.get(port)
		if (!serversForPort) return
		servers.delete(port)
		await closeHeldServer(serversForPort)
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

/** 端口块扫描宽度（并行 live 套件争用同一段时 200 偏紧）。 */
const PORT_BLOCK_SCAN = 2000

/**
 * 分配连续空闲端口块的首端口，并持有至 releasePort / releaseAll。
 * 中途失败时从失败口的下一格继续，避免刚 close 的口立刻重绑。
 * @param {object} options 选项
 * @param {number} options.count 需要的端口数
 * @param {number} [options.step=2] 步长
 * @param {number} [options.preferred=TEST_PORT_BASE] 首选起始端口
 * @returns {Promise<TestPortBlock>} 首端口与释放句柄
 */
export async function allocateTestPortBlock({ count, step = 2, preferred = TEST_PORT_BASE }) {
	const scanEnd = preferred + PORT_BLOCK_SCAN
	for (let base = preferred; base < scanEnd;) {
		const ports = Array.from({ length: count }, (_, index) => base + index * step)
		/** @type {Map<number, import('node:net').Server[]>} */
		const servers = new Map()
		let failedAt = -1
		for (let i = 0; i < ports.length; i++) try {
			servers.set(ports[i], await holdPort(ports[i]))
		}
		catch {
			failedAt = i
			break
		}

		if (failedAt >= 0) {
			await Promise.all([...servers.values()].map(closeHeldServer))
			base = ports[failedAt] + 1
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
 * @property {() => Promise<void>} releaseAll 释放整块持有
 */

/** env 指定端口时无持有句柄。 */
/** @type {() => Promise<void>} */
const noopReleaseAll = async () => {}

/**
 * 为 live 联邦套件分配连续 N 个端口（或读 env）。
 * 分配时以参数 `count` 为准；仅当 env 已指定 `FOUNT_TEST_NODE_1_PORT` 时读端口表（可选 `FOUNT_TEST_NODE_COUNT`）。
 * @param {number} [count=2] 节点数
 * @param {NodeJS.ProcessEnv} [env=process.env] 环境变量
 * @returns {Promise<LiveNodeFleet>} 端口列表与释放句柄
 */
export async function resolveLiveNodeFleet(count = 2, env = process.env) {
	if (!Number.isFinite(count) || count < 1)
		throw new Error(`invalid live node count: ${count}`)

	const rawFirst = env.FOUNT_TEST_NODE_1_PORT?.trim()
	if (rawFirst) {
		const rawCount = env.FOUNT_TEST_NODE_COUNT?.trim()
		const nodeCount = rawCount ? Number(rawCount) : count
		if (!Number.isFinite(nodeCount) || nodeCount < 1)
			throw new Error(`invalid FOUNT_TEST_NODE_COUNT: ${rawCount}`)
		/** @type {number[]} */
		const ports = []
		for (let i = 0; i < nodeCount; i++) {
			const envKey = `FOUNT_TEST_NODE_${i + 1}_PORT`
			const raw = String(env[envKey] || '').trim()
			if (raw) ports.push(Number(raw))
			else if (i === 0) ports.push(Number(rawFirst))
			else ports.push(await pickAvailablePort(ports[i - 1] + 1))
		}
		return { ports, releasePort: noopReleasePort, releaseAll: noopReleaseAll }
	}

	const { base, releasePort, releaseAll } = await allocateTestPortBlock({ count, step: 1 })
	return {
		ports: Array.from({ length: count }, (_, index) => base + index),
		releasePort,
		releaseAll,
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
async function waitForPing(baseUrl, apiKey, timeoutMs = ms('2m'), expectedUsername = null) {
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

/** hold→release→spawn 窗口内端口被抢时的最大重试次数。 */
const LAUNCH_PORT_RACE_RETRIES = 5

/**
 * @param {unknown} error 启动失败
 * @returns {boolean} 是否像端口争用（可换口重试）
 */
function isLaunchPortRaceError(error) {
	if (error instanceof PortCollisionError) return true
	const text = String(error?.message ?? error ?? '')
	return /EADDRINUSE|address already in use/i.test(text)
}

/**
 * 启动一个 headless fount 测试节点子进程。
 * @param {object} [options={}] 启动选项
 * @param {number} [options.port] 监听端口；省略则从 28931 (TEST_PORT_BASE) 起扫描空闲口
 * @param {string} [options.dataPath] 数据目录；省略则 mkdtemp
 * @param {string} [options.username='CI-user'] 用户名
 * @param {string} [options.apiKey] API key；省略则按 port 生成
 * @param {FixtureCopy[]} [options.fixtureCopies] 启动前复制到用户目录的 fixture
 * @param {import('./boot.mjs').TestStarts} [options.starts] 精确透传给测试 worker 内部 `init()` 的 `starts`
 * @param {boolean} [options.needsOutput] 透传给测试 worker 内部 `init()` 的 `needs_output`
 * @param {string[]} [options.loadParts] 启动后要 load 的 partpath
 * @param {boolean} [options.p2p=false] `starts.P2P` 简写；`starts` 已给出时忽略
 * @param {boolean} [options.minP2pNode=false] 无 WebRTC 栈时初始化离线 P2P 身份
 * @param {string} [options.bootstrap] bootstrap 模块绝对路径（default export async (username) => void）
 * @param {boolean} [options.keepData=false] stop 时是否保留 data 目录
 * @param {boolean} [options.captureOutput=false] ready 后是否缓存 stdout/stderr 供断言
 * @param {(port: number) => Promise<void>} [options.releasePort] spawn 前释放该端口的持有 server
 * @param {Record<string, string>} [options.extraEnv] 额外注入子进程的环境变量（不影响父进程 process.env）
 * @returns {Promise<LaunchedNode & { keepData: boolean }>} 已就绪节点句柄
 */
export async function launchNode(options = {}) {
	let lastError
	/** @type {object} */
	let attemptOptions = options
	for (let attempt = 0; attempt < LAUNCH_PORT_RACE_RETRIES; attempt++) 
		try {
			return await launchNodeOnce(attemptOptions)
		}
		catch (error) {
			lastError = error
			if (!isLaunchPortRaceError(error) || attempt === LAUNCH_PORT_RACE_RETRIES - 1) throw error
			// 换口重试：丢掉已 release 的显式端口，重新 hold（fed 节点 env 以返回的 port 为准）。
			attemptOptions = { ...options, port: undefined, releasePort: undefined }
		}
	
	throw lastError
}

/**
 * 单次启动尝试（无端口争用重试）。
 * @param {object} [options={}] 同 {@link launchNode}
 * @returns {Promise<LaunchedNode & { keepData: boolean }>} 已就绪节点句柄
 */
async function launchNodeOnce(options = {}) {
	/** @type {(() => Promise<void>) | undefined} */
	let releasePort = options.releasePort
	let port = options.port
	if (port == null) {
		// hold 至 spawn，消掉 pickAvailablePort 的 TOCTOU（并行 deno test 互抢 28931）。
		const held = await allocateTestPortBlock({ count: 1, step: 1 })
		port = held.base
		const outerRelease = releasePort
		/**
		 *
		 */
		releasePort = async () => {
			await held.releasePort(port)
			await outerRelease?.()
		}
	}
	const username = options.username ?? 'CI-user'
	const apiKey = options.apiKey ?? `fount-test-key-${port}`
	const keepData = options.keepData ?? false
	const dataPath = options.dataPath ?? await mkdtemp(join(tmpdir(), `fount_node_${port}_`))
	const starts = options.starts ?? defaultTestStarts({ web: true, p2p: options.p2p === true })
	/** @type {Record<string, string>} */
	const extraEnv = { ...options.extraEnv }
	let usedTestRelay = false
	let p2pRelayUrl
	if (starts.P2P === true) {
		const { relayUrl } = await startTestNostrRelay()
		p2pRelayUrl = relayUrl
		usedTestRelay = true
	}

	await injectFixtures(dataPath, username, options.fixtureCopies ?? [])

	const v8FlagsArg = buildTestNodeV8FlagsArg()
	const workerArgs = [
		'run', '--allow-scripts', '--allow-all',
		...v8FlagsArg ? [v8FlagsArg] : [],
		'-c', join(REPO_ROOT, 'deno.json'),
		workerPath,
		'--data-path', dataPath,
		'--port', String(port),
		'--user', username,
		'--key', apiKey,
		'--starts', JSON.stringify(starts),
	]
	if (options.needsOutput)
		workerArgs.push('--needs-output')
	for (const part of options.loadParts ?? [])
		workerArgs.push('--load-part', part)
	if (options.bootstrap)
		workerArgs.push('--bootstrap', resolve(options.bootstrap))
	if (options.minP2pNode)
		workerArgs.push('--min-p2p-node')
	if (p2pRelayUrl)
		workerArgs.push('--p2p-relay-url', p2pRelayUrl)

	await releasePort?.()

	const denoBin = typeof Deno !== 'undefined' ? Deno.execPath() : 'deno'
	let captureEnabled = false
	let startupOutput = ''
	let capturedOutput = ''
	/**
	 * @param {string | Uint8Array} chunk stdout/stderr 数据块
	 * @returns {void}
	 */
	const onOutput = chunk => {
		const text = String(chunk)
		if (captureEnabled) {
			if (options.captureOutput) capturedOutput = appendBoundedTail(capturedOutput, text)
			else process.stderr.write(chunk)
			return
		}
		startupOutput = appendBoundedTail(startupOutput, text)
		if (!options.captureOutput) process.stderr.write(chunk)
	}

	// stderr 始终 pipe：否则 EADDRINUSE 走 inherit 进不了 startupOutput，换口重试无法识别。
	const child = spawn(denoBin, workerArgs, {
		cwd: REPO_ROOT,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			FOUNT_TEST: '1',
			FOUNT_TEST_NODE_WORKER: '1',
			FOUNT_DENO_START_TIME: new Date().toISOString(),
			RUST_BACKTRACE: 'full',
			...extraEnv,
		},
	})
	child.stderr.on('data', onOutput)

	/** worker 提前退出时 resolve 退出码（就绪后仍挂着也无害：仅用于 race，不 reject）。 */
	const childExited = new Promise(resolve => {
		child.once('exit', code => resolve(code ?? -1))
	})
	/**
	 * @returns {Promise<never>} worker 在就绪前退出即抛错（fail-fast，免等 ping 超时）
	 */
	const failOnEarlyExit = async () => {
		const code = await childExited
		throw new Error(`node worker exited with code ${code} before ready (port ${port})\n${startupOutput}`.trimEnd())
	}

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
	if (options.captureOutput) child.stdout.on('data', onOutput)
	child.stdout.resume()
	child.stderr.resume()

	if (!readyInfo?.baseUrl)
		await failOnEarlyExit()

	try {
		await Promise.race([
			waitForPing(readyInfo.baseUrl, apiKey, ms('2m'), username),
			failOnEarlyExit(),
		])
	}
	catch (error) {
		if (startupOutput.trim()) error.message += `\n${startupOutput.trimEnd()}`
		try { child.kill('SIGKILL') } catch { /* already dead */ }
		throw error
	}
	captureEnabled = true

	return {
		baseUrl: readyInfo.baseUrl,
		apiKey,
		username,
		port,
		dataPath,
		process: child,
		pid: child.pid,
		keepData,
		usedTestRelay,
		p2pRelayUrl,
		/**
		 * @returns {string} 查看当前已捕获输出但不清空
		 */
		peekOutput: () => capturedOutput,
		/**
		 * @returns {string} 取出当前已捕获输出并清空缓冲
		 */
		takeOutput: () => {
			const out = capturedOutput
			capturedOutput = ''
			return out
		},
	}
}

/**
 * 终止节点子进程并可选清理 data 目录。
 * @param {LaunchedNode & { keepData?: boolean }} node 由 launchNode 返回的句柄
 * @returns {Promise<void>} 进程已结束
 */
export async function stopNode(node) {
	if (!node?.process) return
	const pid = node.pid ?? node.process.pid
	const { process } = node
	process.kill('SIGTERM')
	await Promise.race([
		new Promise(resolve => process.once('close', resolve)),
		new Promise(resolve => setTimeout(resolve, ms('10s'))),
	])
	if (process.exitCode == null)
		process.kill('SIGKILL')
	await Promise.race([
		new Promise(resolve => process.once('close', resolve)),
		new Promise(resolve => setTimeout(resolve, ms('5s'))),
	])
	await collectNodeHeapSnapshots(pid)
	if (!node.keepData && node.dataPath) {
		assertDisposableDataPath(node.dataPath)
		await rm(node.dataPath, { recursive: true, force: true })
	}
	if (node.usedTestRelay)
		await stopTestNostrRelay()
}

if (import.meta.main) {
	const { values } = parseArgsOrExit({
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
