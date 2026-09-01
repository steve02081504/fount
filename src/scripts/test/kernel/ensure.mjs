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
		if (port > 0) {
			const listening = await isPortListening(port)
			// 探查失败（null）不能当作「确认无监听」：落到下方 HTTP 健康检查判定。
			if (listening === false) return false
		}
		const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })
		if (!res.ok) return false
		return (await res.json())?.kernel === TEST_KERNEL_HEALTH_ID
	}
	catch {
		return false
	}
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

/**
 * health 失败则 spawn，轮询直到可连。
 * @param {object} [options] 选项
 * @param {number} [options.port] 端口
 * @returns {Promise<string>} hub URL
 */
export async function ensureTestKernel({ port = TEST_HUB_PORT } = {}) {
	const url = testHubUrl(port)
	if (await kernelHealthy(url)) return url
	await spawnDetachedKernel(port)
	for (let i = 0; i < 50; i++) {
		if (await kernelHealthy(url)) return url
		if (i === 24) await spawnDetachedKernel(port)
		await delay(100)
	}
	throw new Error(`test kernel did not become healthy at ${url}`)
}

/**
 * 杀掉听口进程（跳过自己）。
 * @param {number} port 端口
 * @returns {Promise<boolean>} 是否发出 kill
 */
async function killPortListener(port) {
	const pid = await listenerPid(port)
	if (!pid || pid === process.pid) return false
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
 * @param {number} [options.timeoutMs] 等待 health 消失的上限
 * @returns {Promise<'already_down' | 'stopped'>} 结果
 */
export async function shutdownTestKernel({ port = TEST_HUB_PORT, timeoutMs = 15_000 } = {}) {
	const url = testHubUrl(port)
	// 无监听即已停机：kernelHealthy 内先做监听探查（netstat 快），
	// 避免 Windows 上对死端口 fetch 挂满健康检查超时。
	if (!await kernelHealthy(url)) return 'already_down'
	const started = Date.now()
	const deadline = started + timeoutMs
	try {
		await fetch(`${url}/shutdown`, {
			method: 'POST',
			signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))),
		})
	}
	catch { /* 内核可能在写完响应前就退出；旧内核没有这条路由 */ }
	let killed = false
	while (Date.now() < deadline) {
		// kernelHealthy 先做监听探查（netstat 快）：监听已释放则直接判定停止。
		if (!await kernelHealthy(url)) return 'stopped'
		if (!killed && Date.now() - started >= KILL_AFTER_MS) {
			killed = true
			await killPortListener(port)
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
