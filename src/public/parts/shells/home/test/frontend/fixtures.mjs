import { ms } from 'fount/scripts/ms.mjs'
import { createFountFixtures } from 'fount/scripts/test/playwright/fixtures.mjs'

const GITHUB_PAGES_FOUNT = /^https:\/\/steve02081504\.github\.io\/fount(?:\/|$)/

/**
 * Home 开机同步主题会 iframe 打 GitHub Pages；测试里本地 fulfill，不打外网。
 * @param {object} args fixture 参数
 * @param {import('npm:@playwright/test').Page} args.page Playwright 页面
 * @returns {Promise<void>}
 */
async function stubHomeGithubPagesSync({ page }) {
	await page.route(GITHUB_PAGES_FOUNT, route => route.fulfill({
		status: 200,
		contentType: 'text/html',
		body: '<!doctype html><title>fount</title>',
	}))
}

/**
 * 邀请用例断言该端点失败时页面显示后端详情，这些 4xx/5xx 是按需 mock 的预期失败。
 * @param {{ kind: string, status?: number | null, url?: string }} entry 网络诊断
 * @returns {boolean} 是否豁免
 */
function isExpectedInvitationFailure(entry) {
	return entry.kind === 'http'
		&& [400, 502, 503].includes(entry.status)
		&& new URL(entry.url).pathname === '/api/parts/shells:home/invitation'
}

/** Home 前端 E2E fixture（隔离节点）。 */
export const { test, expect } = createFountFixtures({
	locale: 'zh-CN',
	isolated: {
		shellLabel: 'Home',
		timeout: ms('3m'),
		beforeEach: stubHomeGithubPagesSync,
	},
	shouldIgnoreNetwork: isExpectedInvitationFailure,
})
