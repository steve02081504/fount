/**
 * Playwright 等待 shell 前端 bootstrap 就绪（轮询 `globalThis.fount.test.getState`）。
 */
import { HUB_SHELL_GATE } from 'fount/public/parts/shells/chat/public/hub/gate.mjs'
import { STICKERS_PAGE_GATE } from 'fount/public/parts/shells/chat/public/stickers/gate.mjs'
import { ms } from 'fount/scripts/ms.mjs'
import { SOCIAL_APP_GATE } from 'fount/public/parts/shells/social/public/src/gate.mjs'

/**
 * 在页面内等待 shell 就绪（内存状态 + 可选事件，不依赖 DOM attribute）。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @param {{ id: string, readyEvent: string, errorEvent: string, label: string, timeout?: number }} options gate 与标签
 * @returns {Promise<void>}
 */
export async function waitForReadyGate(page, { id, readyEvent, errorEvent, label, timeout = ms('90s') }) {
	await page.waitForFunction(
		({ id, readyEvent, errorEvent, label }) => {
			const getState = globalThis.fount?.test?.getState
			if (getState) {
				const s = getState(id)
				if (s.status === 'ready') return true
				if (s.status === 'failed')
					throw new Error(s.message ?? `${label} bootstrap failed`)
			}
			return false
		},
		{ id, readyEvent, errorEvent, label },
		{ timeout },
	)
}

/**
 * 等待 Chat Hub shell bootstrap 就绪。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @returns {Promise<void>}
 */
export function waitForHubShellReady(page) {
	return waitForReadyGate(page, {
		...HUB_SHELL_GATE,
		label: 'Hub',
	})
}

/**
 * 等待 Social 应用 bootstrap 就绪。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @returns {Promise<void>}
 */
export function waitForSocialAppReady(page) {
	return waitForReadyGate(page, {
		...SOCIAL_APP_GATE,
		label: 'Social',
		timeout: ms('90s'),
	})
}

/**
 * 等待 Chat 贴纸商店页 bootstrap 就绪。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @returns {Promise<void>}
 */
export function waitForStickersPageReady(page) {
	return waitForReadyGate(page, {
		...STICKERS_PAGE_GATE,
		label: 'Stickers',
		timeout: ms('1m'),
	})
}
