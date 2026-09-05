/**
 * 测试残留物检测：确认一次运行没有在系统留下 Playwright 浏览器目录
 * 或 fount 临时目录。非 CI（GitHub Actions 会装 ms-playwright）的全平台生效。
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
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
 * 本机 ms-playwright 目录（`playwright install` 下载浏览器的位置）。
 * 本地前端测试只用系统 Chrome/Edge，不应出现该目录；CI 例外（会安装）。
 * @returns {string | null} ms-playwright 目录路径；无法确定时返回 null
 */
export function msPlaywrightPath() {
	if (isWindows()) {
		const localAppData = process.env.LOCALAPPDATA
		return localAppData ? join(localAppData, 'ms-playwright') : null
	}
	const cacheRoot = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
	return join(cacheRoot, 'ms-playwright')
}

/**
 * 扫描遗留的 ms-playwright / fount 临时目录。
 * @param {string[]} [baseline] 起始基线路径（debug job 启动时记录），返回中剔除其中已存在者
 * @returns {string[]} 残留路径（空 = 干净）
 */
export function findCleanupLeaks(baseline = []) {
	if (inGitHubActions()) return []
	/** @type {string[]} */
	const leaks = []
	const playwrightDir = msPlaywrightPath()
	if (playwrightDir && existsSync(playwrightDir)) leaks.push(playwrightDir)
	let tempEntries = []
	try {
		tempEntries = readdirSync(tmpdir())
	}
	catch {
		return leaks.filter(leak => !baseline.includes(leak))
	}
	for (const entry of tempEntries)
		if (/^fount[-_]/.test(entry))
			leaks.push(join(tmpdir(), entry))
	return leaks.filter(leak => !baseline.includes(leak))
}
