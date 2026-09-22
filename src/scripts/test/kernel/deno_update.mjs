/**
 * 测试内核侧 Deno 更新：仅在**内核启动**与**测试队列清空并完成**时检查，
 * 而不是每次 `fount test` 调用都跑一遍（旧行为：并发 agent 会同时竞速升级同一二进制）。
 *
 * 与 path CLI 的 `deno_upgrade` 的差异：此处不处理「包管理器拥有的 Deno」（走包管理器升级）。
 * 那需要按平台探测 dpkg/pacman/brew…；测试内核只做自更新，失败仅告警并继续用当前版本，
 * 不阻塞测试。
 *
 * 成功升级后由内核请求重启（只重启测试内核进程，不影响 fount 服务器）。
 */
/* global Deno */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

import { ms } from '../../ms.mjs'

/** 默认升级检查间隔（毫秒）：一小时。 */
export const DEFAULT_UPGRADE_INTERVAL_MS = ms('1h')

/** 缓存标记文件名（与 path 脚本的 deno_upgraded 分开，避免格式/语义互相污染）。 */
const MARKER_NAME = 'deno_upgraded.test'

/** 跨内核升级锁（避免并发内核同时替换同一 deno 二进制）。 */
const LOCK_NAME = 'deno-update.lock'

/**
 * 解析仓库 Deno pin（`.deno-version` 首行）；空则回退 canary。
 * @param {string} repoRoot 仓库根
 * @returns {{ spec: string[], label: string }} `deno upgrade` 参数与展示标签
 */
export function resolveDenoUpgradeSpec(repoRoot) {
	let raw = ''
	try {
		raw = readFileSync(join(repoRoot, '.deno-version'), 'utf8').split('\n')[0].trim()
	}
	catch { /* 无 pin 文件 */ }
	if (!raw) return { spec: ['canary'], label: 'canary' }
	const pr = raw.match(/^pr\s+(\d+)$/)
	if (pr) return { spec: ['pr', pr[1]], label: raw }
	return { spec: [raw], label: raw }
}

/**
 * 读取 `deno -V` 版本串。
 * @returns {Promise<string>} 版本串（失败为空串）
 */
async function denoVersion() {
	try {
		const { stdout } = await new Deno.Command(Deno.execPath(), {
			args: ['-V'],
			stdout: 'piped',
			stderr: 'piped',
		}).output()
		return new TextDecoder().decode(stdout).trim()
	}
	catch {
		return ''
	}
}

/**
 * 读缓存标记；同 channel 且在间隔内则视为新鲜。
 * @param {string} markerPath 标记文件
 * @param {string} label channel / pin 标签
 * @param {number} intervalMs 间隔
 * @returns {boolean} 是否新鲜
 */
function markerFresh(markerPath, label, intervalMs) {
	try {
		const parsed = JSON.parse(readFileSync(markerPath, 'utf8'))
		if (parsed?.channel !== label) return false
		const age = Date.now() - Number(parsed.at)
		return Number.isFinite(age) && age >= 0 && age < intervalMs
	}
	catch {
		return false
	}
}

/**
 * 尝试更新 Deno；仅在需要且未在间隔内时执行。
 *
 * @param {object} [options] 选项
 * @param {string} options.repoRoot 仓库根
 * @param {string} [options.reason] 触发原因（startup / drain），仅用于日志
 * @param {number} [options.intervalMs] 检查间隔
 * @returns {Promise<{ status: string, changed: boolean, label?: string, version?: string }>} 结果
 */
export async function maybeUpgradeDeno({ repoRoot, reason = 'manual', intervalMs = DEFAULT_UPGRADE_INTERVAL_MS } = {}) {
	if (process.env.FOUNT_TEST_SKIP_DENO_UPGRADE === '1')
		return { status: 'skipped', changed: false }
	const envInterval = Number(process.env.FOUNT_TEST_DENO_UPGRADE_INTERVAL)
	if (Number.isFinite(envInterval) && envInterval > 0) intervalMs = envInterval

	const installerDir = join(repoRoot, 'data/installer')
	const markerPath = join(installerDir, MARKER_NAME)
	const { spec, label } = resolveDenoUpgradeSpec(repoRoot)
	if (markerFresh(markerPath, label, intervalMs))
		return { status: 'fresh', changed: false, label }

	const lockPath = join(installerDir, LOCK_NAME)
	mkdirSync(dirname(lockPath), { recursive: true })
	let lockHandle
	try {
		lockHandle = Deno.openSync(lockPath, { createNew: true, write: true })
	}
	catch {
		return { status: 'locked', changed: false, label }
	}
	try {
		const before = await denoVersion()
		const command = new Deno.Command(Deno.execPath(), {
			args: ['upgrade', '-q', ...spec],
			cwd: repoRoot,
			stdout: 'piped',
			stderr: 'piped',
		})
		const result = await command.output()
		const stderr = new TextDecoder().decode(result.stderr).trim()
		if (!result.success) {
			console.warn(`deno upgrade (${label}) failed: ${stderr || `exit ${result.code}`}`)
			return { status: 'failed', changed: false, label }
		}
		const after = await denoVersion()
		const changed = Boolean(after) && after !== before
		writeFileSync(markerPath, JSON.stringify({ channel: label, at: Date.now() }), 'utf8')
		if (changed)
			console.warn(`deno upgraded (${reason}): ${before} -> ${after}`)
		return { status: changed ? 'upgraded' : 'up-to-date', changed, label, version: after || before }
	}
	catch (error) {
		console.warn(`deno upgrade (${label}) failed: ${String(error?.message ?? error)}`)
		return { status: 'failed', changed: false, label }
	}
	finally {
		try { lockHandle?.close() } catch { /* 已关 */ }
		try { rmSync(lockPath, { force: true }) } catch { /* 尽力删除 */ }
	}
}

/**
 * 标记文件是否存在于磁盘（测试用）。
 * @param {string} repoRoot 仓库根
 * @returns {boolean} 是否存在
 */
export function hasUpgradeMarker(repoRoot) {
	try {
		statSync(join(repoRoot, 'data/installer', MARKER_NAME))
		return true
	}
	catch {
		return false
	}
}
