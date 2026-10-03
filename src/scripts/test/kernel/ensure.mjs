/**
 * 测试内核进程：health / spawn / ensure / shutdown / reboot。
 */
/* global Deno */
import { dirname, join } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { launchDetachedProgram } from '../../launch_external.mjs'
import { isPortListening, listenerPid } from '../../listener.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import { TEST_KERNEL_HEALTH_ID } from '../hub/apis/health.mjs'
import { TEST_HUB_PORT, testHubUrl } from '../hub/index.mjs'

const KERNEL_ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'index.mjs')

/** CLI `--kernel` 允许的操作。 */
export const KERNEL_ACTIONS = new Set(['shutdown', 'reboot'])

/** POST /shutdown 之后仍活着则改杀监听进程的等待（兼容旧内核）。 */
const KILL_AFTER_MS = 2000

/**
 * @param {string} url hub URL
 * @returns {Promise<boolean>} 是否健康
 */
export async function kernelHealthy(url) {
	try {
		// 端口确认无监听即不可健康：先查监听（netstat 快），避免 Windows 上对死端口
		// fetch 挂满 1.5s 超时才返回，让 ensure/shutdown 轮询更快。
		const port = Number(new URL(url).port)
		// 探查失败（null）不能当作「确认无监听」：落到下方 HTTP 健康检查判定。
		if (port > 0 && await isPortListening(port) === false) return false
		const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })
		if (!res.ok) return false
		return (await res.json())?.kernel === TEST_KERNEL_HEALTH_ID
	}
	catch {
		return false
	}
}

/**
 * 系统监听探查不可用（例如没有 lsof）时，用本地 TCP 明确拒绝确认空端口。
 * TCP 超时和其他错误仍为未知；迟到的连接也立即关闭，不泄漏 socket。
 * @param {number} port 端口
 * @returns {Promise<boolean | null>} 是否监听；无法判定时 null
 */
async function kernelPortListening(port) {
	const listening = await isPortListening(port)
	if (listening !== null) return listening
	let timer
	try {
		return await Promise.race([
			Deno.connect({ hostname: '127.0.0.1', port }).then(connection => {
				connection.close()
				return true
			}, error => error instanceof Deno.errors.ConnectionRefused ? false : null),
			new Promise(resolve => { timer = setTimeout(() => resolve(null), 1500) }),
		])
	}
	finally { clearTimeout(timer) }
}

/**
 * 拉起 detached 内核（listen 撞端口则该进程立刻退出 0）。
 * @param {number} [port] 端口
 * @param {object} [options] 附加选项
 * @param {Record<string, string>} [options.env] 追加环境变量（覆盖默认）
 * @param {string[]} [options.args] 追加 deno run 参数（插入到入口前）
 * @returns {Promise<void>}
 */
export async function spawnDetachedKernel(port = TEST_HUB_PORT, { env = {}, args = [] } = {}) {
	await launchDetachedProgram({
		command: Deno.execPath(),
		args: [
			'run', '--allow-scripts', '--allow-all',
			'-c', join(REPO_ROOT, 'deno.json'),
			...args,
			KERNEL_ENTRY,
		],
		cwd: REPO_ROOT,
		windowsHide: true,
		env: {
			FOUNT_TEST: '1',
			FOUNT_TEST_KERNEL: '1',
			FOUNT_TEST_HUB_PORT: String(port),
			...env,
		},
	})
}

/** 冷启动内核健康等待上限（毫秒）；慢机器 / 高负载下 5s 过短，会误报 `did not become healthy`。 */
export const DEFAULT_ENSURE_TIMEOUT_MS = 30_000

/**
 * 确认无监听才 spawn；已占用的端口只等健康恢复，绝不自动杀监听者。
 * health 超时无法区分忙碌内核和外来服务，不能作为终止进程的依据。
 * @param {object} [options] 选项
 * @param {number} [options.port] 端口
 * @param {number} [options.timeoutMs] 健康等待上限
 * @param {(url: string) => Promise<boolean>} [options.healthCheck] 健康探查
 * @param {(port: number) => Promise<boolean | null>} [options.portListening] 监听探查
 * @param {(port: number) => Promise<void>} [options.spawnKernel] 无监听时的启动器
 * @returns {Promise<string>} hub URL
 */
export async function ensureTestKernel({
	port = TEST_HUB_PORT, timeoutMs = DEFAULT_ENSURE_TIMEOUT_MS,
	healthCheck = kernelHealthy, portListening = kernelPortListening, spawnKernel = spawnDetachedKernel,
} = {}) {
	const url = testHubUrl(port)
	const deadline = Date.now() + timeoutMs
	/** 听口已确认空闲时就拉起内核，并在半个预算内不重复拉起。 */
	let nextSpawnAt = 0
	for (;;) {
		if (await healthCheck(url)) return url
		if (Date.now() >= deadline) break
		// null 表示探查失败：不得把未知状态当作空端口重复拉起内核。
		if (await portListening(port) === false && Date.now() >= nextSpawnAt) {
			nextSpawnAt = Date.now() + timeoutMs / 2
			await spawnKernel(port)
		}
		await delay(Math.min(100, Math.max(1, deadline - Date.now())))
	}
	throw new Error(`test kernel did not become healthy at ${url} (waited ${timeoutMs}ms; occupied listeners are left running)`)
}

/**
 * 仅显式 shutdown 可杀掉已验证身份且 PID 未变的内核监听进程（跳过自己）。
 * @param {number} port 端口
 * @param {number | null} expectedPid 最初已验证内核的 PID
 * @returns {Promise<boolean>} 是否发出 kill
 */
async function killPortListener(port, expectedPid) {
	const pid = await listenerPid(port)
	if (!pid || pid !== expectedPid || pid === process.pid) return false
	if (!await kernelHealthy(testHubUrl(port))) return false
	try {
		process.kill(pid, 'SIGTERM')
		return true
	}
	catch {
		return false
	}
}

/**
 * 关掉已在跑的内核；本来就没在跑则 already_down。
 * @param {object} [options] 选项
 * @param {number} [options.port] 端口
 * @param {number} [options.timeoutMs] 身份确认与关机共用的等待上限
 * @param {(url: string) => Promise<boolean>} [options.healthCheck] 健康探查
 * @param {(port: number) => Promise<boolean | null>} [options.portListening] 监听探查
 * @returns {Promise<'already_down' | 'stopped'>} 结果
 */
export async function shutdownTestKernel({
	port = TEST_HUB_PORT, timeoutMs = 15_000,
	healthCheck = kernelHealthy, portListening = kernelPortListening,
} = {}) {
	const url = testHubUrl(port)
	const deadline = Date.now() + timeoutMs
	// 健康失败只能说明尚未确认身份；有监听或未知时等待，不能冒充 already_down。
	while (!await healthCheck(url)) {
		if (await portListening(port) === false) return 'already_down'
		if (Date.now() >= deadline)
			throw new Error(`test kernel identity could not be verified at ${url}; listener left running`)
		await delay(Math.min(100, Math.max(1, deadline - Date.now())))
	}
	const expectedPid = await listenerPid(port)
	const started = Date.now()
	try {
		await fetch(`${url}/shutdown`, {
			method: 'POST',
			signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))),
		})
	}
	catch { /* 内核可能在写完响应前就退出；旧内核没有这条路由 */ }
	let killed = false
	while (Date.now() < deadline) {
		// 健康超时不能证明退出；仅监听释放或已验证 PID 被替换才确认停止。
		const currentPid = await listenerPid(port)
		if (currentPid === 0 || (expectedPid && currentPid && currentPid !== expectedPid)) return 'stopped'
		if (currentPid === null && await kernelPortListening(port) === false) return 'stopped'
		if (!killed && Date.now() - started >= KILL_AFTER_MS) {
			killed = true
			await killPortListener(port, expectedPid)
		}
		await delay(100)
	}
	throw new Error(`test kernel did not stop at ${url}`)
}

/**
 * 关掉（若在跑）再拉起。
 * @param {object} [options] 选项
 * @param {number} [options.port] 端口
 * @returns {Promise<string>} hub URL
 */
export async function rebootTestKernel({ port = TEST_HUB_PORT } = {}) {
	await shutdownTestKernel({ port })
	return ensureTestKernel({ port })
}
