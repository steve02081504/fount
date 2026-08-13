/**
 * 确保测试内核在跑：health 失败则拉起 detached 进程。
 */
/* global Deno */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { REPO_ROOT } from '../core/repo_root.mjs'
import { TEST_HUB_PORT, testHubUrl } from '../hub/index.mjs'

const KERNEL_ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'index.mjs')

/**
 * @param {string} url hub URL
 * @returns {Promise<boolean>} 是否健康
 */
export async function kernelHealthy(url) {
	try {
		const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })
		return res.ok
	}
	catch {
		return false
	}
}

/**
 * 拉起 detached 内核（listen 撞端口则该进程立刻退出 0）。
 * @param {number} [port] 端口
 * @returns {Promise<void>}
 */
export async function spawnDetachedKernel(port = TEST_HUB_PORT) {
	await new Promise((resolve, reject) => {
		const child = spawn(Deno.execPath(), [
			'run', '--allow-scripts', '--allow-all',
			'-c', join(REPO_ROOT, 'deno.json'),
			KERNEL_ENTRY,
		], {
			detached: true,
			stdio: 'ignore',
			cwd: REPO_ROOT,
			env: {
				...process.env,
				FOUNT_TEST: '1',
				FOUNT_TEST_KERNEL: '1',
				FOUNT_TEST_HUB_PORT: String(port),
			},
		})
		child.once('spawn', () => {
			child.unref()
			resolve()
		})
		child.once('error', reject)
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
		await delay(100)
	}
	throw new Error(`test kernel did not become healthy at ${url}`)
}
