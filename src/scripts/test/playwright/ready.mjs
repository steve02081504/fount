/**
 * Playwright 等待 shell 前端 bootstrap 就绪（轮询 `globalThis.fount.test.getState`）。
 * Gate 常量先内联；chat/social 落地后可改回从 shell gate 模块导入。
 */
import { ms } from 'fount/scripts/ms.mjs'

const HUB_GATE = {
	id: 'hub',
	readyEvent: 'fount:hub-ready',
	errorEvent: 'fount:hub-error',
}
const STICKERS_PAGE_GATE = {
	id: 'stickers-page',
	readyEvent: 'fount:stickers-page-ready',
	errorEvent: 'fount:stickers-page-error',
}
const SOCIAL_GATE = {
	id: 'social',
	readyEvent: 'fount:social-ready',
	errorEvent: 'fount:social-error',
}

/**
 * 在页面内等待 shell 就绪（轮询内存状态，不依赖 DOM attribute）。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @param {{ id: string, label: string, timeout?: number }} options gate id 与标签
 * @returns {Promise<void>}
 */
export async function waitForReadyGate(page, { id, label, timeout = ms('90s') }) {
	await page.waitForFunction(
		({ id, label }) => {
			const getState = globalThis.fount?.test?.getState
			if (getState) {
				const s = getState(id)
				if (s.status === 'ready') return true
				if (s.status === 'failed')
					throw new Error(s.message ?? `${label} bootstrap failed`)
			}
			return false
		},
		{ id, label },
		{ timeout },
	)
}

/**
 * 等待 Chat Hub shell bootstrap 就绪。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @returns {Promise<void>}
 */
export function waitForHubReady(page) {
	return waitForReadyGate(page, {
		...HUB_GATE,
		label: 'Hub',
	})
}

/**
 * 等待 Social shell bootstrap 就绪。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @returns {Promise<void>}
 */
export function waitForSocialReady(page) {
	return waitForReadyGate(page, {
		...SOCIAL_GATE,
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
