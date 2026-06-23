/**
 * Playwright 等待 shell 前端 bootstrap 就绪（轮询 DOM data-fount-* attribute）。
 */
import { HUB_SHELL_GATE, SOCIAL_APP_GATE } from 'fount/public/pages/scripts/readyGate.mjs'

/**
 * 在页面内等待 shell 就绪 attribute。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @param {{ readyAttr: string, errorAttr: string, label: string, timeout?: number }} options attribute 名与标签
 * @returns {Promise<void>}
 */
export async function waitForShellReadyAttr(page, { readyAttr, errorAttr, label, timeout = 90_000 }) {
	await page.waitForFunction(
		({ readyAttr, errorAttr, label }) => {
			const root = document.documentElement
			if (root.hasAttribute(readyAttr)) return true
			if (root.hasAttribute(errorAttr))
				throw new Error(root.getAttribute(errorAttr) ?? `${label} bootstrap failed`)
			return false
		},
		{ readyAttr, errorAttr, label },
		{ timeout },
	)
}

/**
 * 等待 Chat Hub shell bootstrap 就绪。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @returns {Promise<void>}
 */
export function waitForHubShellReady(page) {
	return waitForShellReadyAttr(page, {
		readyAttr: HUB_SHELL_GATE.readyAttr,
		errorAttr: HUB_SHELL_GATE.errorAttr,
		label: 'Hub',
	})
}

/**
 * 等待 Social 应用 bootstrap 就绪。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @returns {Promise<void>}
 */
export function waitForSocialAppReady(page) {
	return waitForShellReadyAttr(page, {
		readyAttr: SOCIAL_APP_GATE.readyAttr,
		errorAttr: SOCIAL_APP_GATE.errorAttr,
		label: 'Social',
		timeout: 60_000,
	})
}
