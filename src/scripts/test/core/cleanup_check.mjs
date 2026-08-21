/**
 * 测试残留物检测：确认一次运行没有在系统留下 Playwright 浏览器目录
 * 或 fount 临时目录。仅 Windows、非 CI（GitHub Actions 会装 ms-playwright）生效。
 */
import { existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

/** 残留检测失败时 fount test 的退出码。 */
export const CLEANUP_LEAK_EXIT_CODE = 3

/**
 * @returns {boolean} 是否 Windows
 */
export function isWindows() {
	return process.platform === 'win32'
}

/**
 * @returns {boolean} 是否 GitHub Actions（CI 会按需安装 Playwright 浏览器）
 */
export function inGitHubActions() {
	return process.env.GITHUB_ACTIONS === 'true'
}

/**
 * 扫描遗留的 ms-playwright / fount 临时目录。
 * @param {string[]} [baseline] 起始基线路径（debug job 启动时记录），返回中剔除其中已存在者
 * @returns {string[]} 残留路径（空 = 干净）
 */
export function findCleanupLeaks(baseline = []) {
	if (!isWindows() || inGitHubActions()) return []
	/** @type {string[]} */
	const leaks = []
	const localAppData = process.env.LOCALAPPDATA
	if (localAppData) {
		const playwrightDir = join(localAppData, 'ms-playwright')
		if (existsSync(playwrightDir)) leaks.push(playwrightDir)
	}
	let tempEntries = []
	try {
		tempEntries = readdirSync(tmpdir())
	}
	catch {
		return leaks
	}
	for (const entry of tempEntries)
		if (/^fount[-_]/.test(entry))
			leaks.push(join(tmpdir(), entry))
	return leaks.filter(leak => !baseline.includes(leak))
}
