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

/** Home 前端 E2E fixture（隔离节点）。 */
export const { test, expect } = createFountFixtures({
	locale: 'zh-CN',
	isolated: {
		shellLabel: 'Home',
		timeout: ms('3m'),
		beforeEach: stubHomeGithubPagesSync,
	},
})
