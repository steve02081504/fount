import { where_command } from '@steve02081504/exec'

/**
 * 解析本机 Chrome/Edge，供 Playwright 复用（不下载 bundled Chromium）。
 * 关闭 bfcache，避免 E2E 重复导航同一 URL 时页面从冻结状态恢复、入口脚本不重跑。
 * 由 Node 子进程加载（playwright.config.mjs），勿使用 Deno 的 npm: 前缀。
 * @returns {Promise<Partial<import('npm:@playwright/test').PlaywrightTestConfig['use']>>} Playwright `use` 选项
 * @throws {Error} PATH 上找不到 chrome/msedge 时
 */
export async function resolveBrowserUseOptions() {
	for (const command of ['chrome', 'msedge'])
		try {
			const executablePath = await where_command(command)
			if (executablePath)
				return {
					launchOptions: {
						executablePath,
						args: ['--disable-features=BackForwardCache'],
					},
				}
		}
		catch { /* try next */ }

	throw new Error('Playwright: no Chrome/Edge on PATH.')
}
