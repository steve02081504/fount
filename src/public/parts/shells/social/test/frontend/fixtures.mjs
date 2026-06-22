import { request as playwrightRequest } from '@playwright/test'

import { createFountFixtures } from '../../../../../../../.github/workflows/test_lib/playwright_fixtures.mjs'

/** 隔离节点专用测试用户名（与 run.mjs 中 launchNode.username 一致） */
export const TEST_USERNAME = process.env.FOUNT_TEST_USERNAME || 'social-fe-user'

export const { test, expect } = createFountFixtures({ locale: 'zh-CN' })

test.beforeEach(async ({ baseUrl, apiKey }) => {
	if (process.env.FOUNT_TEST_ISOLATED !== '1')
		throw new Error(
			'Social 前端测试须通过 test/frontend/run.mjs 启动（自启隔离节点），'
			+ '勿对本地开发实例或真实用户数据运行。',
		)
	const req = await playwrightRequest.newContext()
	try {
		const whoami = await req.get(`${baseUrl}/api/whoami?fount-apikey=${encodeURIComponent(apiKey)}`)
		if (!whoami.ok())
			throw new Error(`whoami failed: ${whoami.status()}`)
		const data = await whoami.json()
		if (data.username !== TEST_USERNAME)
			throw new Error(
				`测试须使用隔离用户 "${TEST_USERNAME}"，当前为 "${data.username}"。`
				+ '请通过 run.mjs 启动，勿指向生产/开发 fount。',
			)
	}
	finally {
		await req.dispose()
	}
})

/**
 * 打开 Social 首页并等待 i18n 与 feed 就绪。
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @returns {Promise<void>}
 */
export async function openSocialHome(page, baseUrl) {
	await page.goto(`${baseUrl}/parts/shells:social/`)
	await expect(page.locator('h1')).toHaveText('社交', { timeout: 30_000 })
	await expect(page.locator('#feedView')).toBeVisible()
}

/**
 * 通过 composer 发帖并等待 API 成功。
 * @param {import('@playwright/test').Page} page
 * @param {string} text 正文
 * @returns {Promise<object>} 发帖 API 响应 JSON
 */
export async function publishPostViaComposer(page, text) {
	await page.locator('#postText').fill(text)
	const [postResponse] = await Promise.all([
		page.waitForResponse(res =>
			res.url().includes('/api/parts/shells:social/profile/post')
			&& res.request().method() === 'POST'
			&& res.status() === 200,
		),
		page.locator('#postBtn').click(),
	])
	const postJson = await postResponse.json()
	await expect(page.locator('#postText')).toHaveValue('')
	return postJson
}

/**
 * 等待 feed 中出现包含指定文本的帖子卡片。
 * @param {import('@playwright/test').Page} page
 * @param {string} text 帖子正文片段
 * @returns {Promise<import('@playwright/test').Locator>} 匹配的卡片
 */
export async function expectPostInFeed(page, text) {
	const card = page.locator('#feedList .post-card').filter({ hasText: text })
	await expect(card.first()).toBeVisible({ timeout: 20_000 })
	return card.first()
}

/**
 * 读取当前测试用户的 viewer entityHash。
 * @param {string} baseUrl
 * @param {string} apiKey
 * @returns {Promise<string>} entityHash
 */
export async function fetchViewerEntityHash(baseUrl, apiKey) {
	const req = await playwrightRequest.newContext()
	try {
		const res = await req.get(
			`${baseUrl}/api/parts/shells:social/viewer?fount-apikey=${encodeURIComponent(apiKey)}`,
		)
		if (!res.ok()) throw new Error(`viewer failed: ${res.status()}`)
		const data = await res.json()
		if (!data.viewerEntityHash) throw new Error('viewerEntityHash missing')
		return data.viewerEntityHash
	}
	finally {
		await req.dispose()
	}
}
