/**
 * 测试用 fount 节点启动工具（编程 API + CLI）。
 *
 * CLI:
 *   node .github/workflows/test_lib/launch_node.mjs --port 8931 --data /tmp/fount-a --user CI-user --key my-key
 *
 * 编程:
 *   import { launchNode, stopNode } from './launch_node.mjs'
 *   const node = await launchNode({ port: 8931, fixtures: ['test_streamer'] })
 *   try { ... } finally { await stopNode(node) }
 */
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../..')
const WORKER = join(__dirname, 'node_worker.mjs')
const CHAT_FIXTURES = join(REPO_ROOT, 'src/public/parts/shells/chat/test/live/fixtures/chars')

/** @typedef {{ baseUrl: string, apiKey: string, username: string, port: number, dataPath: string, process: import('node:child_process').ChildProcess, pid: number }} LaunchedNode */

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

/**
 * 等待节点 api/ping 返回 pong。
 * @param {string} baseUrl 节点根 URL
 * @param {string} apiKey API key
 * @param {number} [timeoutMs=120000] 超时毫秒
 * @returns {Promise<void>} 就绪后 resolve
 */
async function waitForPing(baseUrl, apiKey, timeoutMs = 120_000) {
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
					if (who.ok) return
				}
			}
		}
		catch { /* retry */ }
		await new Promise(r => setTimeout(r, 500))
	}
	throw new Error(`node not ready within ${timeoutMs}ms: ${baseUrl}`)
}

/**
 * 将 chat 测试 fixture 角色复制到节点用户目录。
 * @param {string} dataPath 节点 data 根目录
 * @param {string} username 目标用户名
 * @param {string[]} fixtureNames char 目录名（来自 chat/test/live/fixtures/chars/）
 * @returns {Promise<void>} 复制完成
 */
async function injectCharFixtures(dataPath, username, fixtureNames) {
	if (!fixtureNames?.length) return
	const destRoot = join(dataPath, 'users', username, 'chars')
	await mkdir(destRoot, { recursive: true })
	for (const name of fixtureNames) {
		const src = join(CHAT_FIXTURES, name)
		const dest = join(destRoot, name)
		await cp(src, dest, { recursive: true })
	}
}

/**
 * 启动一个 headless fount 测试节点子进程。
 * @param {object} [opts={}] 启动选项
 * @param {number} [opts.port=8931] 监听端口
 * @param {string} [opts.dataPath] 数据目录；省略则 mkdtemp
 * @param {string} [opts.username='CI-user'] 用户名
 * @param {string} [opts.apiKey] API key；省略则按 port 生成
 * @param {string[]} [opts.fixtures] 要注入的 char fixture 名
 * @param {boolean} [opts.keepData=false] stop 时是否保留 data 目录
 * @returns {Promise<LaunchedNode & { keepData: boolean }>} 已就绪节点句柄
 */
export async function launchNode(opts = {}) {
	const port = opts.port ?? 8931
	const username = opts.username ?? 'CI-user'
	const apiKey = opts.apiKey ?? `fount-test-key-${port}`
	const keepData = opts.keepData ?? false
	const dataPath = opts.dataPath ?? await mkdtemp(join(tmpdir(), `fount_node_${port}_`))

	await injectCharFixtures(dataPath, username, opts.fixtures ?? [])

	const child = spawn('deno', [
		'run', '--allow-all', '-c', join(REPO_ROOT, 'deno.json'),
		WORKER,
		'--data-path', dataPath,
		'--port', String(port),
		'--user', username,
		'--key', apiKey,
	], {
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

	await waitForPing(readyInfo.baseUrl, apiKey)

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
	try {
		node.process.kill('SIGTERM')
		await new Promise(resolve => node.process.once('close', resolve))
	}
	catch { /* already dead */ }
	if (!node.keepData && node.dataPath)
		await rm(node.dataPath, { recursive: true, force: true }).catch(() => { })
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			port: { type: 'string', default: '8931' },
			data: { type: 'string' },
			user: { type: 'string', default: 'CI-user' },
			key: { type: 'string' },
			fixtures: { type: 'string', default: '' },
		},
	})

	const node = await launchNode({
		port: Number(values.port),
		dataPath: values.data,
		username: values.user,
		apiKey: values.key,
		fixtures: values.fixtures ? values.fixtures.split(',').map(s => s.trim()).filter(Boolean) : [],
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
