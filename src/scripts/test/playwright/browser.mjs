import { createRequire } from 'node:module'
import process from 'node:process'

// 本文件由 Node（Playwright CLI）与 Deno（phases 预读 config）双端加载，不可用 `npm:` 前缀。
import { execFile, where_command } from '@steve02081504/exec'

const require = createRequire(import.meta.url)
const playwrightCli = require.resolve('@playwright/test/cli')

/** 本机可复用的浏览器命令（Windows / Linux / macOS 常见名）。 */
const SYSTEM_BROWSER_COMMANDS = ['chrome', 'msedge', 'google-chrome', 'chromium', 'chromium-browser']

/** @type {Promise<void> | null} */
let playwrightChromeInstall = null

/**
 * @returns {boolean} 是否在 GitHub Actions 中
 */
function inGitHubActions() {
	return process.env.GITHUB_ACTIONS === 'true'
}

/**
 * 在 GHA 中安装 Playwright Chrome for Testing（含系统依赖）；同进程只跑一次。
 * @returns {Promise<void>}
 */
function ensurePlaywrightChrome() {
	if (!playwrightChromeInstall) 
		playwrightChromeInstall = (async () => {
			const result = await execFile('node', [playwrightCli, 'install', '--with-deps', 'chrome'], {
				no_output_record: true,
				/**
				 * @param {string | Uint8Array} data 标准输出
				 * @returns {void}
				 */
				on_stdout: data => process.stdout.write(data),
				/**
				 * @param {string | Uint8Array} data 标准错误
				 * @returns {void}
				 */
				on_stderr: data => process.stderr.write(data),
			})
			if ((result.code ?? 1) !== 0)
				throw new Error(`Playwright: chrome install failed (exit ${result.code}).`)
		})()
	
	return playwrightChromeInstall
}

/**
 * 解析本机 Chrome/Edge，供 Playwright 复用（本地不下载 bundled 浏览器）。
 * GitHub Actions 上若 PATH 无浏览器，则安装 Playwright Chrome for Testing。
 * @returns {Promise<Partial<import('@playwright/test').PlaywrightTestConfig['use']>>} Playwright `use` 选项
 * @throws {Error} 非 GHA 且 PATH 上找不到可用浏览器时
 */
export async function resolveBrowserUseOptions() {
	for (const command of SYSTEM_BROWSER_COMMANDS) {
		const executablePath = await where_command(command)
		if (executablePath)
			return {
				launchOptions: {
					executablePath,
					args: ['--disable-features=BackForwardCache'],
				},
			}
	}

	if (inGitHubActions()) {
		await ensurePlaywrightChrome()
		return {
			channel: 'chrome',
			launchOptions: {
				args: ['--disable-features=BackForwardCache'],
			},
		}
	}

	throw new Error('Playwright: no Chrome/Edge on PATH.')
}
