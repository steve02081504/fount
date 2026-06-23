import { request as playwrightRequest } from '@playwright/test'

import { createFountFixtures } from '../../../../../../../.github/workflows/test_lib/playwright_fixtures.mjs'

/** 隔离节点专用测试用户名（与 run.mjs 中 launchNode.username 一致） */
export const TEST_USERNAME = process.env.FOUNT_TEST_USERNAME || 'social-fe-user'

export const { test: baseTest, expect } = createFountFixtures({ locale: 'zh-CN' })

export const test = baseTest.extend({
	/** @param {(text: string) => Promise<{ postJson: object, postId: string, text: string }>} use */
	publishPost: async ({ page, baseUrl, apiKey }, use) => {
		await use(async text => {
			const postJson = await publishPostViaComposer(page, text, { baseUrl, apiKey })
			const postId = postIdFromResponse(postJson)
			await waitForPostMaterialized(baseUrl, apiKey, postId)
			return { postJson, postId, text }
		})
	},
})

test.beforeEach(async ({ page, baseUrl, apiKey }) => {
	test.setTimeout(300_000)
	await page.addInitScript(() => {
		if (!navigator.clipboard) {
			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText: async () => {} },
				configurable: true,
			})
		}
		else {
			navigator.clipboard.writeText = async () => {}
		}
	})
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
 * 等待 Social bootstrap 完成。
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function waitForSocialReady(page) {
	await page.waitForFunction(async () => {
		const { getSocialAppState, whenSocialAppReady } = await import('/parts/shells:social/src/appReady.mjs')
		const state = getSocialAppState()
		if (state === 'error') throw new Error('Social bootstrap failed')
		if (state === 'ready') return true
		await whenSocialAppReady()
		return true
	}, { timeout: 60_000 })
}

/**
 * 打开 Social 首页并等待 i18n 与 feed 就绪。
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @returns {Promise<void>}
 */
export async function openSocialHome(page, baseUrl) {
	await page.goto(`${baseUrl}/parts/shells:social/`)
	await waitForSocialReady(page)
	await expect(page.locator('#feedView')).toBeVisible({ timeout: 30_000 })
	await expect(page.locator('#postBtn')).toHaveText('发布', { timeout: 30_000 })
}

/**
 * 等待 feed GET 完成。
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<import('@playwright/test').Response>}
 */
export async function waitForFeedLoad(page) {
	return page.waitForResponse(res =>
		res.url().includes('/api/parts/shells:social/feed')
		&& res.request().method() === 'GET'
		&& res.status() === 200,
	)
}

/**
 * 轮询直到帖子出现在 profile posts API 中。
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {string} postId 帖子 id
 * @returns {Promise<string>} entityHash
 */
export async function waitForPostMaterialized(baseUrl, apiKey, postId) {
	const req = await playwrightRequest.newContext()
	try {
		const entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		const key = encodeURIComponent(apiKey)
		for (let attempt = 0; attempt < 40; attempt++) {
			const res = await req.get(
				`${baseUrl}/api/parts/shells:social/profile/${entityHash}/posts?fount-apikey=${key}`,
			)
			if (res.ok()) {
				const data = await res.json()
				const found = (data.items || []).some(item => item.postId === postId)
				if (found) return entityHash
			}
			await new Promise(resolve => setTimeout(resolve, 250))
		}
		throw new Error(`post not materialized within timeout: ${postId}`)
	}
	finally {
		await req.dispose()
	}
}

/**
 * 通过 composer 发帖并等待 API 成功及 feed 刷新。
 * @param {import('@playwright/test').Page} page
 * @param {string} text 正文
 * @param {object} [ctx] 可选 API 上下文
 * @param {string} [ctx.baseUrl]
 * @param {string} [ctx.apiKey]
 * @returns {Promise<object>} 发帖 API 响应 JSON
 */
export async function publishPostViaComposer(page, text, ctx = {}) {
	await page.locator('#postText').fill(text)
	const postWait = page.waitForResponse(res =>
		res.url().includes('/api/parts/shells:social/profile/post')
		&& res.request().method() === 'POST'
		&& res.status() === 200,
	{ timeout: 60_000 },
	)
	const feedWait = waitForFeedLoad(page)
	await page.locator('#postBtn').click()
	let postJson
	try {
		const postResponse = await postWait
		postJson = await postResponse.json()
	}
	catch {
		await expect(page.locator('#postText')).toHaveValue('', { timeout: 30_000 })
		const postId = await page.evaluate(expectedText => {
			for (const card of document.querySelectorAll('#feedView .post-card, #feedList .post-card')) {
				const encoded = card.dataset.postText || ''
				const body = decodeURIComponent(encoded)
				if (body.includes(expectedText) || card.textContent?.includes(expectedText))
					return card.dataset.postId || null
			}
			return null
		}, text)
		if (!postId) throw new Error(`publishPostViaComposer: post "${text}" not visible after composer cleared`)
		postJson = { event: { id: postId } }
	}
	await feedWait.catch(() => waitForFeedLoad(page))
	await expect(page.locator('#postText')).toHaveValue('')
	return postJson
}

/**
 * 从发帖 API 响应解析 postId。
 * @param {object} postJson 发帖响应
 * @returns {string} postId
 */
export function postIdFromResponse(postJson) {
	const id = postJson?.event?.id || postJson?.event?.postId
	if (!id) throw new Error('post response missing event.id')
	return String(id)
}

/**
 * 在 feed 或资料页中按 postId 定位帖子卡片。
 * @param {import('@playwright/test').Page} page
 * @param {string} postId 帖子 id
 * @param {{ preferFeed?: boolean }} [opts]
 * @returns {Promise<import('@playwright/test').Locator>}
 */
export async function findPostCard(page, postId, opts = {}) {
	const preferFeed = opts.preferFeed === true
	const sel = `[data-post-id="${postId}"]`

	/** @param {string} viewId */
	const cardInView = async viewId => {
		const view = page.locator(`#${viewId}`)
		if (await view.evaluate(el => el.classList.contains('hidden'))) return null
		const card = view.locator(sel)
		return await card.count() > 0 ? card.first() : null
	}

	if (!preferFeed) {
		const onFeed = await cardInView('feedView')
		if (onFeed) return onFeed
	}

	if (preferFeed) 
		for (let attempt = 0; attempt < 4; attempt++) {
			const feedCard = await cardInView('feedView')
			if (feedCard) return feedCard
			await Promise.all([
				waitForFeedLoad(page),
				page.locator('#feedRefreshBtn').click(),
			]).catch(() => { })
			const refreshed = await cardInView('feedView')
			if (refreshed) return refreshed
			await page.waitForTimeout(300)
		}
	

	for (let attempt = 0; attempt < 4; attempt++) {
		const feedCard = await cardInView('feedView')
		if (feedCard) return feedCard
		await page.locator('.nav-btn[data-view="profile"]').click()
		await expect(page.locator('#profileView')).toBeVisible({ timeout: 20_000 })
		const profileCard = await cardInView('profileView')
		if (profileCard) return profileCard
		await page.locator('.nav-btn[data-view="feed"]').click()
		await Promise.all([
			waitForFeedLoad(page),
			page.locator('#feedRefreshBtn').click(),
		]).catch(() => { })
		await page.waitForTimeout(300)
	}

	const fallback = page.locator(`.view:not(.hidden) ${sel}`)
	await expect(fallback.first()).toBeVisible({ timeout: 5_000 })
	return fallback.first()
}

/**
 * 等待 feed 中出现指定 postId 的帖子卡片。
 * @param {import('@playwright/test').Page} page
 * @param {string} postId
 * @returns {Promise<import('@playwright/test').Locator>}
 */
export async function expectPostInFeed(page, postId) {
	return findPostCard(page, postId, { preferFeed: true })
}

/**
 * 执行 feed 搜索并等待结果中出现指定 postId。
 * @param {import('@playwright/test').Page} page
 * @param {string} query 搜索词
 * @param {string} postId 期望帖子 id
 * @returns {Promise<void>}
 */
export async function searchAndExpectPost(page, query, postId) {
	for (let attempt = 0; attempt < 8; attempt++) {
		await page.locator('#feedSearchInput').fill(query)
		const searchWait = page.waitForResponse(res =>
			res.url().includes('/api/parts/shells:social/search')
			&& res.request().method() === 'GET'
			&& res.status() === 200,
		)
		await page.locator('#feedSearchBtn').click()
		const searchRes = await searchWait
		const data = await searchRes.json()
		if ((data.items || []).some(item => item.postId === postId)) {
			await expect(page.locator(`#feedList [data-post-id="${postId}"]`)).toBeVisible({
				timeout: 10_000,
			})
			return
		}
		await page.waitForTimeout(400)
	}
	await expect(page.locator(`#feedList [data-post-id="${postId}"]`)).toBeVisible({ timeout: 5_000 })
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
