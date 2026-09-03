import { withApiRequest } from 'fount/scripts/test/playwright/api.mjs'
import { waitForSocialReady } from 'fount/scripts/test/playwright/ready.mjs'

import {
	test,
	expect,
	openHome,
	postIdFromResponse,
	fetchViewerEntityHash,
	waitForPostMaterialized,
	DUMMY_ENTITY_HASH,
} from './fixtures.mjs'

/**
 * 通过 /api/getlocaledata 确定性设置操作者首选语言。
 * @param {string} baseUrl 测试根 URL
 * @param {string} apiKey API 密钥
 * @param {string} locale 首选 locale
 * @returns {Promise<void>} 无返回值
 */
async function setUserLocale(baseUrl, apiKey, locale) {
	await withApiRequest(async request => {
		const response = await request.get(
			`${baseUrl}/api/getlocaledata?preferred=${encodeURIComponent(locale)}&fount-apikey=${encodeURIComponent(apiKey)}`,
		)
		if (!response.ok()) throw new Error(`setUserLocale failed: ${response.status()}`)
	})
}

/**
 * 读取实体资料（chat 壳 entities API）。
 * @param {string} baseUrl 测试根 URL
 * @param {string} apiKey API 密钥
 * @param {string} entityHash 128 位 entityHash
 * @returns {Promise<object>} `{ profile }` 响应
 */
async function getEntityProfile(baseUrl, apiKey, entityHash) {
	return withApiRequest(async request => {
		const response = await request.get(
			`${baseUrl}/api/parts/shells:chat/entities/${encodeURIComponent(entityHash)}?fount-apikey=${encodeURIComponent(apiKey)}`,
		)
		if (!response.ok()) throw new Error(`getEntityProfile failed: ${response.status()}`)
		return response.json()
	})
}

/**
 * 更新实体资料（chat 壳 entities API，保留原 localized 切片）。
 * @param {string} baseUrl 测试根 URL
 * @param {string} apiKey API 密钥
 * @param {string} entityHash 128 位 entityHash
 * @param {object} updates 更新内容
 * @returns {Promise<object>} 更新响应
 */
async function updateEntityProfile(baseUrl, apiKey, entityHash, updates) {
	return withApiRequest(async request => {
		const response = await request.put(
			`${baseUrl}/api/parts/shells:chat/entities/${encodeURIComponent(entityHash)}?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: updates },
		)
		if (!response.ok()) throw new Error(`updateEntityProfile failed: ${response.status()}`)
		return response.json()
	})
}

test.describe('Social profile', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openHome(page, baseUrl)
	})

	test('profile view shows own posts', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`profile-post ${Date.now()}`)
		await page.locator('.side-nav .nav-btn[data-view="profile"]').click()
		await expect(page.locator('#profileView')).toBeVisible()
		await expect(page.locator('#profileView .profile-header')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('#profileView #profileEntityCardHost .profile-popup')).toBeVisible()
		await expect(page.locator('#profileView .profile-popup-banner.entity-profile-banner')).toBeVisible()
		await expect(page.locator(`#profilePostsPanel [data-post-id="${postId}"]`)).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('[data-profile-stat="following"]')).toBeVisible()
		await expect(page.locator('[data-profile-stat="followers"]')).toBeVisible()
		await expect(page.locator('[data-profile-tab="following"]')).toHaveCount(0)
	})

	test('profile likes tab shows liked posts', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`like-tab-src ${Date.now()}`)
		const card = page.locator(`#feedList [data-post-id="${postId}"]`)
		await expect(card).toBeVisible({ timeout: 30_000 })
		await card.locator('[data-like]').click()
		await page.locator('.side-nav .nav-btn[data-view="profile"]').click()
		await page.locator('[data-profile-tab="likes"]').click()
		await expect(page.locator('#profileLikesPanel')).toBeVisible()
		await expect(page.locator(`#profileLikesPanel [data-post-id="${postId}"]`)).toBeVisible({ timeout: 20_000 })
	})

	test('profile settings view saves hideFromDiscovery', async ({ page }) => {
		await page.locator('.side-nav .nav-btn[data-view="profile"]').click()
		await expect(page.locator('[data-profile-settings]')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('[data-profile-edit]')).toBeVisible()
		await page.locator('[data-profile-settings]').click()
		await expect(page.locator('#settingsView')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('.side-nav .nav-btn[data-view="taste"]')).toHaveCount(0)
		const protectedInput = page.locator('#exploreProtectedInput')
		await expect(protectedInput).toBeVisible({ timeout: 10_000 })
		const wasProtected = await protectedInput.isChecked()
		const [metaResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/profile/meta')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			protectedInput.setChecked(!wasProtected),
		])
		const metaJson = await metaResponse.json()
		expect(metaJson).toHaveProperty('socialMeta')
		expect(metaJson.socialMeta?.hideFromDiscovery).toBe(!wasProtected)
	})

	test('deep link opens profile with highlighted post', async ({ page, baseUrl, apiKey, publishPost }) => {
		const { postJson, postId } = await publishPost(`deeplink ${Date.now()}`)
		expect(postIdFromResponse(postJson)).toBe(postId)
		const entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		await waitForPostMaterialized(baseUrl, apiKey, postId)
		await Promise.all([
			page.goto(`${baseUrl}/parts/shells:social/#profile;${entityHash};${postId}`),
			page.waitForResponse(res =>
				res.url().includes(`/api/parts/shells:social/profile/${entityHash}/posts`)
				&& res.request().method() === 'GET'
				&& res.status() === 200,
			),
		])
		await waitForSocialReady(page)
		await expect(page.locator('#profileView')).toBeVisible({ timeout: 30_000 })
		const highlighted = page.locator(`#profileView [data-post-id="${postId}"].highlight-post`)
		await expect(highlighted).toBeVisible({ timeout: 30_000 })
		await expect(highlighted).toHaveClass(/highlight-post/)
	})

	test('follow and unfollow seeded target smoke', async ({ page, baseUrl }) => {
		const dummy = DUMMY_ENTITY_HASH
		await page.goto(`${baseUrl}/parts/shells:social/#profile;${dummy}`)
		await waitForSocialReady(page)
		const followButton = page.locator(`[data-follow="${dummy}"]`)
		await expect(followButton).toBeVisible({ timeout: 20_000 })
		await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/relationships/follow')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			followButton.click(),
		])
		await expect(followButton).toHaveAttribute('data-is-following', '1', { timeout: 20_000 })
		await page.locator('.side-nav .nav-btn[data-view="profile"]').click()
		await expect(page.locator('[data-profile-settings]')).toBeVisible({ timeout: 20_000 })
		await page.locator('[data-profile-stat="following"]').click()
		await expect(page.locator('#profileRelationshipList .following-link')).toContainText(dummy.slice(0, 8), { timeout: 20_000 })
		await page.goto(`${baseUrl}/parts/shells:social/`)
		await waitForSocialReady(page)
		await page.evaluate(eh => { window.location.hash = `profile;${eh}` }, dummy)
		const unfollowButton = page.locator(`[data-follow="${dummy}"]`)
		await expect(unfollowButton).toBeVisible({ timeout: 30_000 })
		await expect(unfollowButton).toHaveAttribute('data-is-following', '1', { timeout: 10_000 })
		await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/relationships/follow')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			{ timeout: 60_000 }),
			unfollowButton.click(),
		])
		await expect(unfollowButton).toHaveAttribute('data-is-following', '0', { timeout: 20_000 })
	})

	test('clicking my profile wins over in-flight deep-linked friend profile', async ({ page, baseUrl }) => {
		const dummy = DUMMY_ENTITY_HASH
		// 延迟朋友的 profile GET（含其 posts GET）：让"我的"点击发生在朋友主页仍在加载时
		await page.route(`**/api/parts/shells:social/profile/${dummy}**`, async route => {
			await new Promise(resolve => setTimeout(resolve, 3000))
			await route.continue()
		})
		const friendProfileRequest = page.waitForRequest(req =>
			req.method() === 'GET'
			&& new URL(req.url()).pathname === `/api/parts/shells:social/profile/${dummy}`,
		)
		await page.goto(`${baseUrl}/parts/shells:social/#profile;${dummy}`, { waitUntil: 'domcontentloaded' })
		// 朋友 profile GET 已发出 → nav 按钮已绑定，朋友主页仍在加载
		await friendProfileRequest
		await page.locator('.side-nav .nav-btn[data-view="profile"]').click()
		// 自己的主页应先渲染出来
		await expect(page.locator('[data-profile-settings]')).toBeVisible({ timeout: 30_000 })
		// 等朋友（延迟的）主页加载窗口过去，确认其过期渲染没有覆盖"我的"
		await page.waitForTimeout(4000)
		await expect(page.locator('[data-profile-settings]')).toBeVisible()
		await expect(page.locator(`[data-follow="${dummy}"]`)).toHaveCount(0)
		await expect(page).toHaveURL(/#profile$/)
	})

	test('dm button navigates to chat contact link smoke', async ({ page, baseUrl }) => {
		const dummy = DUMMY_ENTITY_HASH
		await page.goto(`${baseUrl}/parts/shells:social/#profile;${dummy}`)
		await waitForSocialReady(page)
		await page.locator(`[data-dm="${dummy}"]`).click()
		await expect(page).toHaveURL(
			new RegExp(`/parts/shells:chat/hub/\\?contact=${dummy}`),
			{ timeout: 20_000 },
		)
	})

	test('copy dm link button copies chat contact deep link', async ({ page, baseUrl }) => {
		const dummy = DUMMY_ENTITY_HASH
		await page.goto(`${baseUrl}/parts/shells:social/#profile;${dummy}`)
		await waitForSocialReady(page)
		const copyButton = page.locator(`[data-copy-dm="${dummy}"]`)
		await expect(copyButton).toBeVisible({ timeout: 20_000 })

		// 记录剪贴板写入（social 的 copyTextToClipboard 经 navigator.clipboard.writeText 复制）
		await page.evaluate(() => {
			window.__copiedTexts = []
			/**
			 * 记录被复制到剪贴板的文本。
			 * @param {string} text 被写入剪贴板的文本
			 */
			const recordWrite = (text) => { window.__copiedTexts.push(text) }
			navigator.clipboard.writeText = recordWrite
		})
		await copyButton.click()

		const origin = new URL(baseUrl).origin
		await expect.poll(() => page.evaluate(() => window.__copiedTexts), { timeout: 10_000 })
			.toEqual([`${origin}/parts/shells:chat/hub/?contact=${dummy}`])
	})

	test('blocklist shows blocked entity and unblocks smoke', async ({ page, baseUrl, apiKey }) => {
		const dummy = DUMMY_ENTITY_HASH
		const blockRes = await page.request.post(
			`${baseUrl}/api/parts/shells:social/relationships/block?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: { entityHash: dummy, block: true } },
		)
		expect(blockRes.ok()).toBe(true)
		await page.locator('.side-nav .nav-btn[data-view="profile"]').click()
		await expect(page.locator('[data-profile-settings]')).toBeVisible({ timeout: 20_000 })
		await page.locator('[data-profile-settings]').click()
		await expect(page.locator('#settingsView')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator(`#blocklistSection [data-unblock="${dummy}"]`)).toBeVisible({ timeout: 20_000 })
		await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/relationships/block')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			page.locator(`[data-unblock="${dummy}"]`).click(),
		])
		await expect(page.locator(`[data-unblock="${dummy}"]`)).toHaveCount(0, { timeout: 20_000 })
	})

	test('shared profile popup reflects a freshly-updated profile without reload', async ({ page, baseUrl, apiKey }) => {
		// 与 chat 的资料弹层同款「点开即拉最新」：Social/Cabinet 复用的跨壳 shared popup
		// 必须展示最新资料，而不是命中旧缓存。
		const entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		await setUserLocale(baseUrl, apiKey, 'zh-CN')

		const before = await getEntityProfile(baseUrl, apiKey, entityHash)
		const localized = { ...before.profile?.localized || {} }
		const zhSlice = { ...localized['zh-CN'] || {} }
		const originalName = zhSlice.name ?? ''
		const newName = `Social Renamed ${Date.now()}`
		await updateEntityProfile(baseUrl, apiKey, entityHash, {
			localized: { ...localized, 'zh-CN': { ...zhSlice, name: newName } },
		})
		try {
			// Social 无点击弹层入口（悬停走 shared hover card），此处直接唤起 shared popup 验证数据路径
			await page.evaluate(async (hash) => {
				const { showEntityProfilePopup } = await import('/parts/shells:chat/shared/entityProfilePopup.mjs')
				await showEntityProfilePopup({ entityHash: hash })
			}, entityHash)

			const popup = page.locator('#shared-entity-profile-popup-layer')
			await expect(popup).toBeVisible({ timeout: 20_000 })
			await expect(popup.locator('[data-entity-profile-name]')).toHaveText(newName, { timeout: 20_000 })
		}
		finally {
			// 恢复原名，避免影响同 phase 其余用例
			await updateEntityProfile(baseUrl, apiKey, entityHash, {
				localized: { ...localized, 'zh-CN': { ...zhSlice, name: originalName } },
			}).catch(() => { })
		}
	})
})
