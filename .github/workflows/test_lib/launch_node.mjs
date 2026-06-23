/**
 * 测试用 fount 节点启动工具（编程 API + CLI）。
 *
 * CLI:
 *   node .github/workflows/test_lib/launch_node.mjs --port 8931 --data /tmp/fount-a --user CI-user --key my-key
 *
 * 编程:
 *   import { launchNode, stopNode } from './launch_node.mjs'
 *   import { runPlaywrightWithNode } from './playwright_run.mjs'
 *   const node = await launchNode({ port: 8931, loadParts: ['shells/social'], p2p: true })
 *   try { ... } finally { await stopNode(node) }
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

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../..')
const WORKER = join(__dirname, 'node_worker.mjs')

/** @typedef {{ from: string, to: string }} FixtureCopy 复制到 users/<user>/<to> */

/** @typedef {{ baseUrl: string, apiKey: string, username: string, port: number, dataPath: string, process: import('node:child_process').ChildProcess, pid: number }} LaunchedNode */

/**
 * @param {number} port 待检测端口
 * @returns {Promise<boolean>} 127.0.0.1 上是否可监听
 */
function isPortFree(port) {
	return new Promise(resolve => {
		const server = net.createServer()
		server.unref()
		server.on('error', () => resolve(false))
		server.listen(port, '127.0.0.1', () => {
			server.close(() => resolve(true))
		})
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
 * 选取连续 `count` 个按 `step` 间隔的空闲口，返回首端口。
 * @param {number} preferred 首端口候选
 * @param {number} count 需要的口数
 * @param {number} [step=1] 步长
 * @returns {Promise<number>} 连续块的首端口
 */
export async function pickAvailablePortBlock(preferred, count, step = 1) {
	for (let base = preferred; base < preferred + 200; base++) {
		const ports = Array.from({ length: count }, (_, i) => base + i * step)
		if ((await Promise.all(ports.map(isPortFree))).every(Boolean)) return base
	}
	throw new Error(`no free ${count}-port block from ${preferred} step ${step}`)
}

/**
 * @param {string} pattern glob（* 与 **）
 * @param {string} path 待匹配路径（正斜杠）
 * @returns {boolean} 路径是否匹配 pattern
 */
export function matchGlob(pattern, path) {
	const norm = path.replace(/\\/g, '/')
	const pat = pattern.replace(/\\/g, '/')
	if (pat === norm) return true
	const re = new RegExp('^' + pat
		.replace(/\./g, '\\.')
		.replace(/\*\*/g, '{{GLOBSTAR}}')
		.replace(/\*/g, '[^/]*')
		.replace(/\{\{GLOBSTAR\}\}/g, '.*')
		+ '$')
	return re.test(norm)
}

/** 端口被其它 fount 实例占用（whoami 用户名不符）。 */
export class PortCollisionError extends Error {
	/**
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
			const res = await fetch(`${baseUrl}/api/ping?fount-apikey=${encodeURIComponent(apiKey)}`, {
				method: 'GET',
				cache: 'no-store',
			})
			if (res.ok) {
				const data = await res.json()
				if (data?.message === 'pong') {
					const who = await fetch(`${baseUrl}/api/whoami?fount-apikey=${encodeURIComponent(apiKey)}`, {
						method: 'GET',
						cache: 'no-store',
					})
					if (who.ok) {
						if (expectedUsername != null) {
							const whoData = await who.json()
							if (whoData?.username !== expectedUsername)
								throw new PortCollisionError(
									baseUrl,
									expectedUsername,
									whoData?.username ?? '(missing)',
								)
						}
						return
					}
				}
			}
		}
		catch (err) {
			if (err instanceof PortCollisionError) throw err
		}
		await new Promise(r => setTimeout(r, 500))
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
 * @param {object} [opts={}] 启动选项
 * @param {number} [opts.port] 监听端口；省略则从 8931 起扫描空闲口
 * @param {string} [opts.dataPath] 数据目录；省略则 mkdtemp
 * @param {string} [opts.username='CI-user'] 用户名
 * @param {string} [opts.apiKey] API key；省略则按 port 生成
 * @param {FixtureCopy[]} [opts.fixtureCopies] 启动前复制到用户目录的 fixture
 * @param {string[]} [opts.loadParts] 启动后要 load 的 partpath
 * @param {boolean} [opts.p2p=false] 是否启用 P2P 子系统
 * @param {string} [opts.bootstrap] bootstrap 模块绝对路径（default export async (username) => void）
 * @param {boolean} [opts.keepData=false] stop 时是否保留 data 目录
 * @returns {Promise<LaunchedNode & { keepData: boolean }>} 已就绪节点句柄
 */
export async function launchNode(opts = {}) {
	const port = opts.port ?? await pickAvailablePort(8931)
	const username = opts.username ?? 'CI-user'
	const apiKey = opts.apiKey ?? `fount-test-key-${port}`
	const keepData = opts.keepData ?? false
	const dataPath = opts.dataPath ?? await mkdtemp(join(tmpdir(), `fount_node_${port}_`))

	await injectFixtures(dataPath, username, opts.fixtureCopies ?? [])

	const workerArgs = [
		'run', '--allow-all', '-c', join(REPO_ROOT, 'deno.json'),
		WORKER,
		'--data-path', dataPath,
		'--port', String(port),
		'--user', username,
		'--key', apiKey,
	]
	if (opts.p2p) workerArgs.push('--p2p')
	for (const part of opts.loadParts ?? [])
		workerArgs.push('--load-part', part)
	if (opts.bootstrap)
		workerArgs.push('--bootstrap', resolve(opts.bootstrap))

	const child = spawn('deno', workerArgs, {
		cwd: REPO_ROOT,
		stdio: ['ignore', 'pipe', 'inherit'],
	})

	let readyInfo = null
	const rl = createInterface({ input: child.stdout })
	for await (const line of rl) {
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
	rl.close()

	if (!readyInfo?.baseUrl)
		throw new Error(`node_worker did not emit ready JSON (port ${port})`)

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
	const proc = node.process
	try {
		proc.kill('SIGTERM')
		await Promise.race([
			new Promise(resolve => proc.once('close', resolve)),
			new Promise(resolve => setTimeout(resolve, 10_000)),
		])
		if (proc.exitCode == null)
			proc.kill('SIGKILL')
		await Promise.race([
			new Promise(resolve => proc.once('close', resolve)),
			new Promise(resolve => setTimeout(resolve, 5_000)),
		])
	}
	catch { /* already dead */ }
	if (!node.keepData && node.dataPath)
		await rm(node.dataPath, { recursive: true, force: true }).catch(() => { })
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
	 * CLI 收到退出信号时停止节点。
	 * @returns {Promise<void>} 停止完成后 process.exit
	 */
	const onExit = async () => {
		await stopNode({ ...node, keepData: true })
		process.exit(0)
	}
	process.on('SIGINT', onExit)
	process.on('SIGTERM', onExit)
	await new Promise(resolve => node.process.once('close', resolve))
}
