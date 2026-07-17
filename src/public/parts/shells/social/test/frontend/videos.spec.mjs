import { request as playwrightRequest } from '@playwright/test'

import {
	test,
	expect,
	openSocialHome,
	postIdFromResponse,
	waitForPostMaterialized,
	fetchViewerEntityHash,
	submitReplyViaPanel,
} from './fixtures.mjs'

/**
 * 经 Social HTTP API 发帖。
 * @param {import('@playwright/test').APIRequestContext} req 请求上下文
 * @param {string} baseUrl 根 URL
 * @param {string} apiKey API 密钥
 * @param {object} body 发帖体
 * @returns {Promise<string>} postId
 */
async function publishViaApi(req, baseUrl, apiKey, body) {
	const res = await req.post(
		`${baseUrl}/api/parts/shells:social/posts?fount-apikey=${encodeURIComponent(apiKey)}`,
		{ data: body },
	)
	expect(res.ok(), `publish failed: ${res.status()}`).toBeTruthy()
	return postIdFromResponse(await res.json())
}

/**
 * 打开短视频视图并定位指定 slide。
 * @param {import('@playwright/test').Page} page 页面
 * @param {string} postId 帖子 id
 * @returns {Promise<import('@playwright/test').Locator>} slide 定位器
 */
async function openVideoSlide(page, postId) {
	const feedPromise = page.waitForResponse(res => {
		if (res.request().method() !== 'GET' || res.status() !== 200) return false
		return new URL(res.url()).pathname === '/api/parts/shells:social/videos/feed'
	}, { timeout: 60_000 })
	await page.locator('.side-nav .nav-btn[data-view="videos"]').click()
	await feedPromise
	const slide = page.locator(`#videosView .video-slide[data-post-id="${postId}"]`).first()
	await expect(slide).toBeVisible({ timeout: 30_000 })
	return slide
}

test.describe('Social short videos', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
		await page.evaluate(() => localStorage.removeItem('fount.social.video.muted'))
	})

	test('renders own video post in vertical snap feed', async ({ page, baseUrl, apiKey }) => {
		const text = `short-video ${Date.now()}`
		const req = await playwrightRequest.newContext()
		let postId
		try {
			postId = await publishViaApi(req, baseUrl, apiKey, {
				text,
				visibility: 'public',
				locale: 'zh-CN',
				mediaRefs: [{
					kind: 'video',
					url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
				}],
			})
		}
		finally {
			await req.dispose()
		}
		await waitForPostMaterialized(baseUrl, apiKey, postId)

		const slide = await openVideoSlide(page, postId)
		await expect(page.locator(`#videosView .video-slide[data-post-id="${postId}"]`)).toHaveCount(1)
		await expect(slide.locator('.video-caption')).toContainText(text)
		await expect(slide.locator('video.video-player')).toHaveAttribute('src', /flower\.mp4/)
		await expect(slide.locator('.video-author')).not.toHaveText('')
		await expect(slide.locator('.video-actions')).toBeVisible()
		await expect(slide.locator('.video-share-btn')).toBeVisible()
	})

	test('empty replies panel can be closed', async ({ page, baseUrl, apiKey }) => {
		const text = `video-replies-close ${Date.now()}`
		const req = await playwrightRequest.newContext()
		let postId
		try {
			postId = await publishViaApi(req, baseUrl, apiKey, {
				text,
				visibility: 'public',
				locale: 'zh-CN',
				mediaRefs: [{
					kind: 'video',
					url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
				}],
			})
		}
		finally {
			await req.dispose()
		}
		await waitForPostMaterialized(baseUrl, apiKey, postId)

		const slide = await openVideoSlide(page, postId)
		const panel = slide.locator('[data-replies-panel]')
		await slide.locator('.video-comment-btn').click()
		await expect(panel).not.toHaveClass(/hidden/)
		await expect(panel.locator('[data-close-replies]')).toBeVisible()
		await expect(panel.locator('.reply-composer')).toBeVisible()

		await panel.locator('[data-close-replies]').click()
		await expect(panel).toHaveClass(/hidden/)

		await slide.locator('.video-comment-btn').click()
		await expect(panel).not.toHaveClass(/hidden/)
		// 点视频中部空白区关闭（避开左上角返回钮）
		const video = slide.locator('video.video-player')
		const box = await video.boundingBox()
		await video.click({
			position: {
				x: Math.max(80, (box?.width || 200) * 0.5),
				y: Math.max(120, (box?.height || 400) * 0.55),
			},
		})
		await expect(panel).toHaveClass(/hidden/)
	})

	test('share button copies link fallback', async ({ page, baseUrl, apiKey }) => {
		const text = `video-share ${Date.now()}`
		const req = await playwrightRequest.newContext()
		let postId
		try {
			postId = await publishViaApi(req, baseUrl, apiKey, {
				text,
				visibility: 'public',
				locale: 'zh-CN',
				mediaRefs: [{
					kind: 'video',
					url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
				}],
			})
		}
		finally {
			await req.dispose()
		}
		await waitForPostMaterialized(baseUrl, apiKey, postId)

		const slide = await openVideoSlide(page, postId)
		await page.evaluate(() => {
			Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
		})
		await slide.locator('.video-share-btn').click()
		await expect(slide.locator('.video-share-btn .action-count')).toHaveText('已复制', { timeout: 5_000 })
	})

	test('comment ticker shows existing replies', async ({ page, baseUrl, apiKey }) => {
		const text = `video-ticker ${Date.now()}`
		const replyText = `ticker-reply ${Date.now()}`
		const req = await playwrightRequest.newContext()
		let postId
		let replyId
		let entityHash
		try {
			entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
			postId = await publishViaApi(req, baseUrl, apiKey, {
				text,
				visibility: 'public',
				locale: 'zh-CN',
				mediaRefs: [{
					kind: 'video',
					url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
				}],
			})
			await waitForPostMaterialized(baseUrl, apiKey, postId)
			replyId = await publishViaApi(req, baseUrl, apiKey, {
				text: replyText,
				replyTo: { entityHash, postId },
				visibility: 'public',
				locale: 'zh-CN',
			})
		}
		finally {
			await req.dispose()
		}
		await waitForPostMaterialized(baseUrl, apiKey, replyId)

		const slide = await openVideoSlide(page, postId)
		const ticker = slide.locator('[data-comment-ticker]')
		await expect(ticker).not.toHaveClass(/hidden/, { timeout: 30_000 })
		await expect(ticker.locator('.video-comment-ticker-item').first()).toContainText(replyText)
	})

	test('video replies panel accepts a reply while feed card exists', async ({ page, baseUrl, apiKey }) => {
		const text = `video-reply-send ${Date.now()}`
		const replyText = `from-video ${Date.now()}`
		const req = await playwrightRequest.newContext()
		let postId
		try {
			postId = await publishViaApi(req, baseUrl, apiKey, {
				text,
				visibility: 'public',
				locale: 'zh-CN',
				mediaRefs: [{
					kind: 'video',
					url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
				}],
			})
		}
		finally {
			await req.dispose()
		}
		await waitForPostMaterialized(baseUrl, apiKey, postId)

		// feed 里需有同帖卡片（含 data-replies-for）；发评必须落到当前 slide 面板而非 feed 空面板
		await Promise.all([
			page.waitForResponse(res => {
				if (res.request().method() !== 'GET' || res.status() !== 200) return false
				return new URL(res.url()).pathname === '/api/parts/shells:social/feed'
			}, { timeout: 60_000 }),
			page.locator('#feedRefreshButton').click(),
		])
		await expect(page.locator(`#feedList .post-card[data-post-id="${postId}"]`).first()).toBeVisible({ timeout: 30_000 })

		const slide = await openVideoSlide(page, postId)
		const panel = slide.locator('[data-replies-panel]')
		await slide.locator('.video-comment-btn').click()
		await expect(panel).not.toHaveClass(/hidden/)
		await panel.locator('textarea').fill(replyText)
		await submitReplyViaPanel(page, panel)
		await expect(panel.locator('.reply')).toContainText(replyText, { timeout: 30_000 })
		await expect(slide.locator('.video-comment-btn .action-count')).toHaveText('1')
	})

	test('mute preference persists after leaving videos view', async ({ page, baseUrl, apiKey }) => {
		const text = `video-mute-pref ${Date.now()}`
		const req = await playwrightRequest.newContext()
		let postId
		try {
			postId = await publishViaApi(req, baseUrl, apiKey, {
				text,
				visibility: 'public',
				locale: 'zh-CN',
				mediaRefs: [{
					kind: 'video',
					url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
				}],
			})
		}
		finally {
			await req.dispose()
		}
		await waitForPostMaterialized(baseUrl, apiKey, postId)

		const slide = await openVideoSlide(page, postId)
		const video = slide.locator('video.video-player')
		await expect(video).toHaveJSProperty('muted', false)
		await slide.locator('.video-mute-btn').click()
		await expect(video).toHaveJSProperty('muted', true)
		await expect.poll(() => page.evaluate(() => localStorage.getItem('fount.social.video.muted')))
			.toBe('1')

		await page.locator('#videosViewBackButton').click()
		await expect(page.locator('#videosView')).toHaveClass(/hidden/)
		const slideAgain = await openVideoSlide(page, postId)
		await expect(slideAgain.locator('video.video-player')).toHaveJSProperty('muted', true)
		await expect(slideAgain.locator('.video-mute-btn .s-ic')).toHaveClass(/s-ic-mute/)
	})

	test('comment ticker opens replies panel at that reply', async ({ page, baseUrl, apiKey }) => {
		const text = `video-ticker-jump ${Date.now()}`
		const replyA = `ticker-a ${Date.now()}`
		const replyB = `ticker-b ${Date.now()}`
		const req = await playwrightRequest.newContext()
		let postId
		let replyIdB
		let entityHash
		try {
			entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
			postId = await publishViaApi(req, baseUrl, apiKey, {
				text,
				visibility: 'public',
				locale: 'zh-CN',
				mediaRefs: [{
					kind: 'video',
					url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
				}],
			})
			await waitForPostMaterialized(baseUrl, apiKey, postId)
			await publishViaApi(req, baseUrl, apiKey, {
				text: replyA,
				replyTo: { entityHash, postId },
				visibility: 'public',
				locale: 'zh-CN',
			})
			replyIdB = await publishViaApi(req, baseUrl, apiKey, {
				text: replyB,
				replyTo: { entityHash, postId },
				visibility: 'public',
				locale: 'zh-CN',
			})
		}
		finally {
			await req.dispose()
		}
		await waitForPostMaterialized(baseUrl, apiKey, replyIdB)

		const slide = await openVideoSlide(page, postId)
		const ticker = slide.locator('[data-comment-ticker]')
		await expect(ticker).not.toHaveClass(/hidden/, { timeout: 30_000 })
		await ticker.evaluate(el => {
			el.querySelector('.video-comment-ticker-track')?.classList.remove('is-scrolling')
		})
		const target = ticker.locator(`.video-comment-ticker-item[data-reply-id="${replyIdB}"]`).first()
		await expect(target).toBeVisible()
		await target.click({ force: true })

		const panel = slide.locator('[data-replies-panel]')
		await expect(panel).not.toHaveClass(/hidden/)
		const focused = panel.locator(`.reply[data-reply-id="${replyIdB}"]`)
		await expect(focused).toHaveClass(/is-focused/)
		await expect(focused).toContainText(replyB)
		await expect(focused.locator('.hash-avatar, .author-avatar, .reply-avatar')).toBeVisible()
	})
})

