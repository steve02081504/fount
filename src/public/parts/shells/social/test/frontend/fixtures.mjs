import { Buffer } from 'node:buffer'

import { ms } from 'fount/scripts/ms.mjs'
import {
	withApiRequest,
	createChatTestGroup,
	fetchViewerEntityHash as fetchViewerEntityHashShared,
} from 'fount/scripts/test/playwright/api.mjs'
import { createFountFixtures } from 'fount/scripts/test/playwright/fixtures.mjs'
import { waitForSocialReady } from 'fount/scripts/test/playwright/ready.mjs'

import {
	FOREIGN_FE_AUTHOR_HASH,
	SEEDED_TEST_TARGET_HASH,
} from './seedConstants.mjs'

/** 隔离节点专用测试用户名（由 run.mjs 注入 FOUNT_TEST_USERNAME） */
export const TEST_USERNAME = process.env.FOUNT_TEST_USERNAME

/** 经 bootstrap 注册 network hint 的可发现测试目标（follow/block 烟测）。 */
export const DUMMY_ENTITY_HASH = SEEDED_TEST_TARGET_HASH

/** bootstrap 联邦 ingest 的远程作者（治理菜单烟测）。 */
export { FOREIGN_FE_AUTHOR_HASH }

/**
 * 安装 clipboard stub（share/copy 烟测避免缺 API）。
 * @param {object} args fixture 参数
 * @param {import('npm:@playwright/test').Page} args.page Playwright 页面
 * @returns {Promise<void>}
 */
async function installClipboardStub({ page }) {
	await page.addInitScript(() => {
		if (!navigator.clipboard)
			Object.defineProperty(navigator, 'clipboard', {
				value: {
					/* eslint-disable-next-line jsdoc/require-jsdoc -- stub */
					writeText: async () => { },
				},
				configurable: true,
			})
		else
			/**
			 *
			 */
			navigator.clipboard.writeText = async () => { }
	})
}

/**
 * Social 前端 E2E 测试套件（扩展 publishPost fixture）。
 */
export const { test: baseTest, expect } = createFountFixtures({
	locale: 'zh-CN',
	isolated: {
		shellLabel: 'Social',
		timeout: ms('3m'),
		beforeEach: installClipboardStub,
	},
})

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

/**
 * 打开 Social 首页并等待 i18n 与 feed 就绪。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} baseUrl - 测试根 URL。
 * @returns {Promise<void>}
 */
export async function openHome(page, baseUrl) {
	await page.goto(`${baseUrl}/parts/shells:social/`, { waitUntil: 'domcontentloaded' })
	await waitForSocialReady(page)
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
	const entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
	const key = encodeURIComponent(apiKey)
	return withApiRequest(async req => {
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
	})
}

/**
 * 通过 composer 发帖并等待 API 成功与输入框清空。
 * 不硬等 feed GET：发帖后的 loadFeed 可能叠在联邦 backfill 上，易超时；
 * 帖子可见性由 publishPost fixture 的 waitForPostMaterialized / findPostCard 负责。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} text - 帖子正文。
 * @param {{ baseUrl?: string, apiKey?: string }} [api] - 可选 API 上下文（当前未使用，预留扩展）。
 * @returns {Promise<object>} 发帖 API 响应 JSON（含 event.id）。
 */
export async function publishPostViaComposer(page, text, api = {}) {
	await page.locator('#postText').fill(text)
	const [postResponse] = await Promise.all([
		page.waitForResponse(res => {
			if (res.request().method() !== 'POST' || res.status() !== 200) return false
			return new URL(res.url()).pathname === '/api/parts/shells:social/posts'
		}, { timeout: ms('1m') }),
		page.locator('#postButton').click(),
	])
	const postJson = await postResponse.json()
	await expect(page.locator('#postText')).toHaveValue('', { timeout: ms('30s') })
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
 * @param {{ preferFeed?: boolean }} [options] - 查找选项。
 * @returns {Promise<import('npm:@playwright/test').Locator>} 帖子卡片定位器。
 */
export async function findPostCard(page, postId, options = {}) {
	const allowProfileFallback = options.allowProfileFallback === true
	const sel = `[data-post-id="${postId}"]`
	const feedCard = page.locator(`#feedView ${sel}`)
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			// feed GET 返回后 DOM 渲染是异步的；等可见而非查 count，避免竞态
			await expect(feedCard.first()).toBeVisible({ timeout: ms('5s') })
			return feedCard.first()
		}
		catch { /* 未渲染或不在本页，刷新重试 */ }
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
export const expectPostInFeed = findPostCard

/**
 * 轮询 feed 搜索直到目标帖出现在 API 结果与 DOM 中。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} query - 搜索词。
 * @param {string} postId - 期望帖子 id。
 * @returns {Promise<void>}
 */
async function pollSearchForPost(page, query, postId) {
	for (let attempt = 0; attempt < 2; attempt++) {
		await page.locator('#feedSearchInput').fill(query)
		const searchWait = page.waitForResponse(res => {
			if (res.request().method() !== 'GET' || res.status() !== 200) return false
			return new URL(res.url()).pathname === '/api/parts/shells:social/search'
		}, { timeout: ms('1m') })
		await page.locator('#feedSearchInput').press('Enter')
		const searchRes = await searchWait
		const data = await searchRes.json()
		if ((data.items || []).some(item => item.postId === postId)) {
			await expect(page.locator(`#searchViewResults [data-post-id="${postId}"]`).first()).toBeVisible({
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
	await pollSearchForPost(page, query, postId)
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
	const key = encodeURIComponent(apiKey)
	await withApiRequest(async req => {
		for (let index = 0; index < count; index++) {
			const res = await req.post(
				`${baseUrl}/api/parts/shells:social/posts?fount-apikey=${key}`,
				{ data: { text: `${textPrefix}-${index}-${Date.now()}`, visibility: 'public', locale: 'zh-CN' } },
			)
			if (!res.ok()) throw new Error(`seed post failed: ${res.status()}`)
		}
	})
}

/**
 * Social 前端建群：包装 `createChatTestGroup`，默认 name/description 带 social 前缀。
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} apiKey - API 密钥。
 * @param {{ name?: string, description?: string }} [options] - 可选项。
 * @returns {Promise<{ groupId: string, channelId: string, defaultChannelId: string }>} 群与默认频道 id。
 */
export function createTestGroup(baseUrl, apiKey, options = {}) {
	return createChatTestGroup(baseUrl, apiKey, {
		description: 'social frontend test',
		...options,
		name: options.name ?? `social-fe-group-${Date.now()}`,
	})
}

/** 极短黑帧 mp4，供 videos 前端测；经 page.route 本地 fulfill，不打外网。 */
export const VIDEO_FIXTURE_PATH = '/__fount_test__/tiny.mp4'

/** @see VIDEO_FIXTURE_PATH */
export const TINY_MP4_BUFFER = Buffer.from(
	'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAANcbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAHgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAod0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAB4AAAEAAABAAAAAAH/bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAACABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABqm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAWpzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4xNi4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAMg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAL7iAAAAAAAAABhzdHRzAAAAAAAAAAEAAAADAAACAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAKGN0dHMAAAAAAAAAAwAAAAEAAAQAAAAAAQAABgAAAAABAAACAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAwAAAAEAAAAgc3RzegAAAAAAAAAAAAAAAwAAAsUAAAAMAAAADAAAABRzdGNvAAAAAAAAAAEAAAOMAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2Mi42LjEwMQAAAAhmcmVlAAAC5W1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIzIDA0ODBjYjAgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAPZYiEADP//vbsvgU2FMjBAAAACEGaImxCv/7AAAAACAGeQXkK/8SB',
	'base64',
)

/**
 * 拦截 VIDEO_FIXTURE_PATH，返回 TINY_MP4_BUFFER。
 * @param {import('@playwright/test').Page} page 页面
 * @returns {Promise<void>}
 */
export async function installVideoFixtureRoute(page) {
	await page.route(`**${VIDEO_FIXTURE_PATH}`, route => route.fulfill({
		status: 200,
		headers: { 'Content-Type': 'video/mp4' },
		body: TINY_MP4_BUFFER,
	}))
}

/**
 * 绝对 URL，写入 mediaRefs 后由浏览器加载（需先 installVideoFixtureRoute）。
 * @param {string} baseUrl 测试根 URL
 * @returns {string} 视频 fixture 的绝对 URL
 */
export function videoFixtureUrl(baseUrl) {
	return new URL(VIDEO_FIXTURE_PATH, baseUrl).href
}

/** 1×1 PNG，供 composer 媒体上传烟测。 */
export const TINY_PNG_BUFFER = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
	'base64',
)

/**
 * 读取当前测试用户的 viewer entityHash（含 ECONNRESET 重试）。
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} apiKey - API 密钥。
 * @returns {Promise<string>} entityHash
 */
export function fetchViewerEntityHash(baseUrl, apiKey) {
	return fetchViewerEntityHashShared(baseUrl, apiKey, { retries: 2 })
}

/**
 * 通过 API 关注指定 entity。
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} apiKey - API 密钥。
 * @param {string} entityHash - 目标 entityHash。
 * @returns {Promise<void>}
 */
export async function followEntityViaApi(baseUrl, apiKey, entityHash) {
	await withApiRequest(async req => {
		const res = await req.post(
			`${baseUrl}/api/parts/shells:social/relationships/follow?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: { entityHash, follow: true } },
		)
		if (!res.ok()) throw new Error(`follow failed: ${res.status()}`)
	})
}

/**
 * 关注 bootstrap 远程作者并刷新 feed，返回其帖子卡片定位器。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} apiKey - API 密钥。
 * @returns {Promise<import('npm:@playwright/test').Locator>} 远程作者帖子卡片。
 */
export async function findForeignAuthorPostCard(page, baseUrl, apiKey) {
	await followEntityViaApi(baseUrl, apiKey, FOREIGN_FE_AUTHOR_HASH)
	const [feedResponse] = await Promise.all([
		waitForFeedLoad(page),
		page.locator('#feedRefreshButton').click(),
	])
	await feedResponse.json()
	const card = page.locator(`#feedList .post-card[data-author-entity="${FOREIGN_FE_AUTHOR_HASH}"]`).first()
	await expect(card).toBeVisible({ timeout: 30_000 })
	return card
}

/**
 * 注入远程作者点赞，生成 viewer 收件箱通知。
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} apiKey - API 密钥。
 * @param {string} targetEntityHash - 被赞帖作者。
 * @param {string} targetPostId - 被赞帖 id。
 * @returns {Promise<void>}
 */
export async function injectForeignLike(baseUrl, apiKey, targetEntityHash, targetPostId) {
	const key = encodeURIComponent(apiKey)
	await followEntityViaApi(baseUrl, apiKey, FOREIGN_FE_AUTHOR_HASH)
	await withApiRequest(async req => {
		const res = await req.post(
			`${baseUrl}/api/parts/shells:social/test/foreign-like?fount-apikey=${key}`,
			{ data: { targetEntityHash, targetPostId } },
		)
		if (!res.ok()) throw new Error(`foreign-like failed: ${res.status()}`)
	})
}

/**
 * 通过 API 批量远程点赞以生成通知（用于通知分页烟测）。
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} apiKey - API 密钥。
 * @param {number} [count=41] - 通知卡片数量。
 * @returns {Promise<void>}
 */
export async function seedNotificationsViaReplies(baseUrl, apiKey, count = 41) {
	const viewerEntityHash = await fetchViewerEntityHash(baseUrl, apiKey)
	const key = encodeURIComponent(apiKey)
	await withApiRequest(async req => {
		for (let index = 0; index < count; index++) {
			const parentRes = await req.post(
				`${baseUrl}/api/parts/shells:social/posts?fount-apikey=${key}`,
				{ data: { text: `notif-seed-parent-${index}-${Date.now()}`, visibility: 'public', locale: 'zh-CN' } },
			)
			if (!parentRes.ok()) throw new Error(`parent post failed: ${parentRes.status()}`)
			const postId = postIdFromResponse(await parentRes.json())
			await injectForeignLike(baseUrl, apiKey, viewerEntityHash, postId)
		}
	})
}

/**
 * 直接写入 like 收件箱行（聚合烟测加速路径）。
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} apiKey - API 密钥。
 * @param {string} targetEntityHash - 被赞帖作者。
 * @param {string} targetPostId - 被赞帖 id。
 * @param {number} [count=2] - like 行数。
 * @returns {Promise<void>}
 */
export async function seedInboxLikes(baseUrl, apiKey, targetEntityHash, targetPostId, count = 2) {
	const key = encodeURIComponent(apiKey)
	await withApiRequest(async req => {
		const res = await req.post(
			`${baseUrl}/api/parts/shells:social/test/inbox-likes?fount-apikey=${key}`,
			{ data: { targetEntityHash, targetPostId, count } },
		)
		if (!res.ok()) throw new Error(`inbox-likes failed: ${res.status()}`)
	})
}

/**
 * 直接写入 mention 收件箱行（分页烟测加速路径）。
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} apiKey - API 密钥。
 * @param {number} [count=41] - 行数。
 * @returns {Promise<void>}
 */
export async function seedInboxMentions(baseUrl, apiKey, count = 41) {
	const key = encodeURIComponent(apiKey)
	await withApiRequest(async req => {
		const res = await req.post(
			`${baseUrl}/api/parts/shells:social/test/inbox-mentions?fount-apikey=${key}`,
			{ data: { count } },
		)
		if (!res.ok()) throw new Error(`inbox-mentions failed: ${res.status()}`)
	})
}
