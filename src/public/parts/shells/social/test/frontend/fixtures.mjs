import { Buffer } from 'node:buffer'

import { request as playwrightRequest } from '@playwright/test'
import { ms } from 'fount/scripts/ms.mjs'
import { createFountFixtures } from 'fount/scripts/test/playwright/fixtures.mjs'
import { assertIsolatedFrontendTest } from 'fount/scripts/test/playwright/guards.mjs'
import { waitForSocialAppReady } from 'fount/scripts/test/playwright/ready.mjs'

import { SEEDED_TEST_TARGET_HASH } from '../seedKnownEntity.mjs'

/** 隔离节点专用测试用户名（由 run.mjs 注入 FOUNT_TEST_USERNAME） */
export const TEST_USERNAME = process.env.FOUNT_TEST_USERNAME

/** 经 bootstrap 注册 network hint 的可发现测试目标（follow/block 烟测）。 */
export const DUMMY_ENTITY_HASH = SEEDED_TEST_TARGET_HASH

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

/** @type {string[]} 当前用例收集的浏览器 pageerror（afterEach 断言为空）。 */
const collectedPageErrors = []

baseTest.beforeEach(async ({ page, baseUrl, apiKey }) => {
	if (!TEST_USERNAME)
		throw new Error('FOUNT_TEST_USERNAME is required; run via test/frontend/run.mjs')
	baseTest.setTimeout(ms('3m'))
	collectedPageErrors.length = 0
	page.on('pageerror', err => collectedPageErrors.push(String(err?.message || err)))
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

baseTest.afterEach(async () => {
	expect(collectedPageErrors, 'unexpected browser page errors').toEqual([])
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
	await expect(page.locator('#feedView')).toBeVisible({ timeout: ms('30s') })
	await expect(page.locator('#postButton[data-i18n="social.composer.publish"]')).toBeVisible()
	await expect(page.locator('#postButton')).not.toHaveText('', { timeout: ms('30s') })
}

/**
 * 打开帖子卡片溢出菜单。
 * @param {import('npm:@playwright/test').Locator} card - 帖子卡片定位器。
 * @returns {Promise<void>}
 */
export async function openPostMoreMenu(card) {
	await card.locator('[data-more-toggle]').click()
	await expect(card.locator('.post-more-menu')).not.toHaveClass(/hidden/)
}

/**
 * 等待 feed GET 完成。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {number} [timeout=60000] 等待毫秒数。
 * @returns {Promise<import('npm:@playwright/test').Response>} feed GET 响应。
 */
export async function waitForFeedLoad(page, timeout = ms('1m')) {
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
		for (let attempt = 0; attempt < 15; attempt++) {
			const profileRes = await req.get(
				`${baseUrl}/api/parts/shells:social/profile/${entityHash}/posts?fount-apikey=${key}`,
			)
			const feedRes = await req.get(`${baseUrl}/api/parts/shells:social/feed?fount-apikey=${key}`)
			const inProfile = profileRes.ok()
				&& (await profileRes.json()).items?.some(item => item.postId === postId)
			const inFeed = feedRes.ok()
				&& (await feedRes.json()).items?.some(item => item.postId === postId)
			if (inProfile && inFeed) return entityHash
			await new Promise(resolve => setTimeout(resolve, 200))
		}
		throw new Error(`post not materialized in profile+feed: ${postId}`)
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
		return new URL(res.url()).pathname === '/api/parts/shells:social/posts'
	}, { timeout: ms('1m') })
	const feedWait = waitForFeedLoad(page)
	await page.locator('#postButton').click()
	const postResponse = await postWait
	const postJson = await postResponse.json()
	await feedWait
	await expect(page.locator('#postText')).toHaveValue('')
	return postJson
}

/**
 * 提交回复并等待 POST 完成（避免后续 page.goto 打断在途请求）。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {import('npm:@playwright/test').Locator} panel - 回复面板定位器。
 * @returns {Promise<void>}
 */
export async function submitReplyViaPanel(page, panel) {
	await Promise.all([
		page.waitForResponse(res =>
			res.url().includes('/api/parts/shells:social/posts')
			&& res.request().method() === 'POST'
			&& res.status() === 200,
		{ timeout: ms('30s') }),
		panel.locator('[data-submit-reply]').click(),
	])
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
 * 刷新 feed 并等待 GET 完成。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @returns {Promise<void>}
 */
async function refreshFeed(page) {
	await Promise.all([
		waitForFeedLoad(page),
		page.locator('#feedRefreshButton').click(),
	])
}

/**
 * 在 feed 或资料页中按 postId 定位帖子卡片。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} postId - 帖子 id。
 * @param {{ preferFeed?: boolean }} [opts] - 查找选项。
 * @returns {Promise<import('npm:@playwright/test').Locator>} 帖子卡片定位器。
 */
export async function findPostCard(page, postId, opts = {}) {
	const allowProfileFallback = opts.allowProfileFallback === true
	const sel = `[data-post-id="${postId}"]`
	const feedCard = page.locator(`#feedView ${sel}`)
	for (let attempt = 0; attempt < 2; attempt++) {
		if (await feedCard.count() > 0) {
			await expect(feedCard.first()).toBeVisible({ timeout: ms('15s') })
			return feedCard.first()
		}
		await refreshFeed(page)
	}
	if (allowProfileFallback) {
		await page.locator('.side-nav .nav-btn[data-view="profile"]').click()
		const profileCard = page.locator(`#profileView ${sel}`)
		await expect(profileCard.first()).toBeVisible({ timeout: ms('15s') })
		return profileCard.first()
	}
	throw new Error(`post ${postId} not found in feed (set allowProfileFallback to search profile)`)
}

/**
 * 等待 feed 中出现指定 postId 的帖子卡片。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} postId - 帖子 id。
 * @returns {Promise<import('npm:@playwright/test').Locator>} 帖子卡片定位器。
 */
export async function expectPostInFeed(page, postId) {
	return findPostCard(page, postId)
}

/**
 * 轮询 feed 搜索直到目标帖出现在 API 结果与 DOM 中。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} query - 搜索词。
 * @param {string} postId - 期望帖子 id。
 * @param {'button' | 'enter'} trigger - 触发搜索的方式。
 * @returns {Promise<void>}
 */
async function pollSearchForPost(page, query, postId, trigger) {
	for (let attempt = 0; attempt < 2; attempt++) {
		await page.locator('#feedSearchInput').fill(query)
		const searchWait = page.waitForResponse(res => {
			if (res.request().method() !== 'GET' || res.status() !== 200) return false
			return new URL(res.url()).pathname === '/api/parts/shells:social/search'
		}, { timeout: ms('1m') })
		if (trigger === 'enter')
			await page.locator('#feedSearchInput').press('Enter')
		else if (await page.locator('#feedSearchButton').isVisible())
			await page.locator('#feedSearchButton').click()
		else
			await page.locator('#feedSearchInput').press('Enter')
		const searchRes = await searchWait
		const data = await searchRes.json()
		if ((data.items || []).some(item => item.postId === postId)) {
			await expect(page.locator(`#feedList [data-post-id="${postId}"]`)).toBeVisible({
				timeout: ms('10s'),
			})
			return
		}
		if (attempt === 0)
			await page.waitForTimeout(300)
	}
	throw new Error(`search did not return post ${postId} for query ${query}`)
}

/**
 * 执行 feed 搜索并等待结果中出现指定 postId。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} query - 搜索词。
 * @param {string} postId - 期望帖子 id。
 * @returns {Promise<void>} 无返回值。
 */
export async function searchAndExpectPost(page, query, postId) {
	await pollSearchForPost(page, query, postId, 'button')
}

/**
 * 通过 Enter 触发搜索并断言目标帖可见。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} query - 搜索词。
 * @param {string} postId - 期望出现的帖子 id。
 * @returns {Promise<void>}
 */
export async function searchViaEnterAndExpectPost(page, query, postId) {
	await pollSearchForPost(page, query, postId, 'enter')
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
				`${baseUrl}/api/parts/shells:social/posts?fount-apikey=${key}`,
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
