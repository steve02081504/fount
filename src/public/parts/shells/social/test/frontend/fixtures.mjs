import { Buffer } from 'node:buffer'

import { request as playwrightRequest } from '@playwright/test'
import { createFountFixtures } from 'fount/scripts/test/playwright/fixtures.mjs'
import { assertIsolatedFrontendTest, stubSentryOnPage } from 'fount/scripts/test/playwright/guards.mjs'
import { waitForSocialAppReady } from 'fount/scripts/test/playwright/ready.mjs'

/** 隔离节点专用测试用户名（由 run.mjs 注入 FOUNT_TEST_USERNAME） */
export const TEST_USERNAME = process.env.FOUNT_TEST_USERNAME

/** 无真实 replica 的占位 entityHash（follow/block API 烟测用）。 */
export const DUMMY_ENTITY_HASH = 'a'.repeat(128)

/**
 * Social 前端 E2E 测试套件（扩展 publishPost fixture）。
 */
export const { test: baseTest, expect } = createFountFixtures({ locale: 'zh-CN' })

/**
 * 扩展 publishPost 的 Social 测试套件。
 */
export const test = baseTest.extend({
	/**
	 * 通过 composer 发帖的 fixture。
	 * @param {(text: string) => Promise<{ postJson: object, postId: string, text: string }>} use - Playwright fixture use 回调。
	 */
	publishPost: async ({ page, baseUrl, apiKey }, use) => {
		await use(async text => {
			const postJson = await publishPostViaComposer(page, text, { baseUrl, apiKey })
			const postId = postIdFromResponse(postJson)
			await waitForPostMaterialized(baseUrl, apiKey, postId)
			return { postJson, postId, text }
		})
	},
})

baseTest.beforeEach(async ({ page, baseUrl, apiKey }) => {
	if (!TEST_USERNAME)
		throw new Error('FOUNT_TEST_USERNAME is required; run via test/frontend/run.mjs')
	baseTest.setTimeout(300_000)
	page.on('pageerror', err => console.log('[browser:pageerror]', err.message, err.stack))
	await stubSentryOnPage(page)
	await page.addInitScript(() => {
		if (!navigator.clipboard)
			Object.defineProperty(navigator, 'clipboard', {
				value: { /** @returns {Promise<void>} */
					writeText: async () => { }
				},
				configurable: true,
			})
		else
			/** @returns {Promise<void>} */
			navigator.clipboard.writeText = async () => { }
	})
	await assertIsolatedFrontendTest({
		baseUrl,
		apiKey,
		expectedUsername: TEST_USERNAME,
		shellLabel: 'Social',
	})
})

/**
 * 打开 Social 首页并等待 i18n 与 feed 就绪。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} baseUrl - 测试根 URL。
 * @returns {Promise<void>}
 */
export async function openSocialHome(page, baseUrl) {
	await page.goto(`${baseUrl}/parts/shells:social/`, { waitUntil: 'domcontentloaded' })
	await waitForSocialAppReady(page)
	await expect(page.locator('#feedView')).toBeVisible({ timeout: 30_000 })
	await expect(page.locator('#postBtn[data-i18n="social.composer.publish"]')).toBeVisible()
	await expect(page.locator('#postBtn')).not.toHaveText('', { timeout: 30_000 })
}

/**
 * 等待 feed GET 完成。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @returns {Promise<import('npm:@playwright/test').Response>} feed GET 响应。
 */
export async function waitForFeedLoad(page, timeout = 60_000) {
	return page.waitForResponse(res => {
		if (res.request().method() !== 'GET' || res.status() !== 200) return false
		return new URL(res.url()).pathname === '/api/parts/shells:social/feed'
	}, { timeout })
}

/**
 * 轮询直到帖子出现在 profile posts API 中。
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} apiKey - API 密钥。
 * @param {string} postId - 帖子 id。
 * @returns {Promise<string>} entityHash。
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
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} text - 帖子正文。
 * @param {{ baseUrl?: string, apiKey?: string }} [api] - 可选 API 上下文（当前未使用，预留扩展）。
 * @returns {Promise<object>} 发帖 API 响应 JSON（含 event.id）。
 */
export async function publishPostViaComposer(page, text, api = {}) {
	await page.locator('#postText').fill(text)
	const postWait = page.waitForResponse(res => {
		if (res.request().method() !== 'POST' || res.status() !== 200) return false
		return new URL(res.url()).pathname === '/api/parts/shells:social/profile/post'
	}, { timeout: 60_000 })
	const feedWait = waitForFeedLoad(page)
	await page.locator('#postBtn').click()
	const postResponse = await postWait
	const postJson = await postResponse.json()
	await feedWait
	await expect(page.locator('#postText')).toHaveValue('')
	return postJson
}

/**
 * 从发帖 API 响应解析 postId。
 * @param {object} postJson - 发帖响应。
 * @returns {string} postId。
 */
export function postIdFromResponse(postJson) {
	const id = postJson?.event?.id || postJson?.event?.postId
	if (!id) throw new Error('post response missing event.id')
	return String(id)
}

/**
 * 在 feed 或资料页中按 postId 定位帖子卡片。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} postId - 帖子 id。
 * @param {{ preferFeed?: boolean }} [opts] - 查找选项。
 * @returns {Promise<import('npm:@playwright/test').Locator>} 帖子卡片定位器。
 */
export async function findPostCard(page, postId, opts = {}) {
	const preferFeed = opts.preferFeed === true
	const sel = `[data-post-id="${postId}"]`

	/**
	 * 在指定视图中查找帖子卡片。
	 * @param {string} viewId - 视图元素 id。
	 * @returns {Promise<import('npm:@playwright/test').Locator | null>} 定位器或 null。
	 */
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
		// 等待 profile 帖子真正渲染完成（view 可见 ≠ 帖子已加载）
		const profileCard = page.locator(`#profileView ${sel}`)
		const profileFound = await profileCard.isVisible({ timeout: 20_000 }).catch(() => false)
		if (profileFound) return profileCard
		await page.locator('.nav-btn[data-view="feed"]').click()
		await Promise.all([
			waitForFeedLoad(page),
			page.locator('#feedRefreshBtn').click(),
		]).catch(() => { })
		await page.waitForTimeout(300)
	}

	const fallback = page.locator(`.view:not(.hidden) ${sel}`)
	await expect(fallback.first()).toBeVisible({ timeout: 15_000 })
	return fallback.first()
}

/**
 * 等待 feed 中出现指定 postId 的帖子卡片。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} postId - 帖子 id。
 * @returns {Promise<import('npm:@playwright/test').Locator>} 帖子卡片定位器。
 */
export async function expectPostInFeed(page, postId) {
	return findPostCard(page, postId, { preferFeed: true })
}

/**
 * 执行 feed 搜索并等待结果中出现指定 postId。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} query - 搜索词。
 * @param {string} postId - 期望帖子 id。
 * @returns {Promise<void>} 无返回值。
 */
export async function searchAndExpectPost(page, query, postId) {
	for (let attempt = 0; attempt < 8; attempt++) {
		await page.locator('#feedSearchInput').fill(query)
		const searchWait = page.waitForResponse(res => {
			if (res.request().method() !== 'GET' || res.status() !== 200) return false
			return new URL(res.url()).pathname === '/api/parts/shells:social/search'
		}, { timeout: 60_000 })
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
 * 通过 API 批量发帖（用于分页等需大量帖子的场景）。
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} apiKey - API 密钥。
 * @param {number} count - 发帖数量。
 * @param {string} [textPrefix] - 正文前缀。
 * @returns {Promise<void>}
 */
export async function seedPostsViaApi(baseUrl, apiKey, count, textPrefix = 'seed') {
	const req = await playwrightRequest.newContext()
	try {
		const key = encodeURIComponent(apiKey)
		for (let index = 0; index < count; index++) {
			const res = await req.post(
				`${baseUrl}/api/parts/shells:social/profile/post?fount-apikey=${key}`,
				{ data: { text: `${textPrefix}-${index}-${Date.now()}`, visibility: 'public', lang: 'zh-CN' } },
			)
			if (!res.ok()) throw new Error(`seed post failed: ${res.status()}`)
		}
	}
	finally {
		await req.dispose()
	}
}

/**
 * 通过 Chat API 创建测试群（供 Social 群关联 composer 烟测）。
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} apiKey - API 密钥。
 * @param {{ name?: string }} [opts] - 可选项。
 * @returns {Promise<{ groupId: string, channelId: string }>} 群与默认频道 id。
 */
export async function createTestGroup(baseUrl, apiKey, opts = {}) {
	const name = opts.name ?? `social-fe-group-${Date.now()}`
	const req = await playwrightRequest.newContext()
	try {
		const res = await req.post(
			`${baseUrl}/api/parts/shells:chat/groups/?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: { name, description: 'social frontend test' } },
		)
		if (!res.ok()) throw new Error(`createTestGroup failed: ${res.status()}`)
		const data = await res.json()
		if (!data.groupId) throw new Error('groupId missing')
		return { groupId: data.groupId, channelId: data.defaultChannelId || 'default' }
	}
	finally {
		await req.dispose()
	}
}

/** 1×1 PNG，供 composer 媒体上传烟测。 */
export const TINY_PNG_BUFFER = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
	'base64',
)

/**
 * 读取当前测试用户的 viewer entityHash。
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} apiKey - API 密钥。
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
