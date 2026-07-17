import { request as playwrightRequest } from '@playwright/test'

import {
	test,
	expect,
	openSocialHome,
	postIdFromResponse,
	waitForPostMaterialized,
} from './fixtures.mjs'

test.describe('Social short videos', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('renders own video post in vertical snap feed', async ({ page, baseUrl, apiKey }) => {
		const text = `short-video ${Date.now()}`
		const req = await playwrightRequest.newContext()
		let postId
		try {
			const res = await req.post(
				`${baseUrl}/api/parts/shells:social/posts?fount-apikey=${encodeURIComponent(apiKey)}`,
				{
					data: {
						text,
						visibility: 'public',
						locale: 'zh-CN',
						mediaRefs: [{
							kind: 'video',
							url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
						}],
					},
				},
			)
			expect(res.ok(), `publish video post failed: ${res.status()}`).toBeTruthy()
			postId = postIdFromResponse(await res.json())
		}
		finally {
			await req.dispose()
		}
		await waitForPostMaterialized(baseUrl, apiKey, postId)

		const feedPromise = page.waitForResponse(res => {
			if (res.request().method() !== 'GET' || res.status() !== 200) return false
			return new URL(res.url()).pathname === '/api/parts/shells:social/videos/feed'
		}, { timeout: 60_000 })
		await page.locator('.side-nav .nav-btn[data-view="videos"]').click()
		const feedRes = await feedPromise
		const feed = await feedRes.json()
		expect((feed.items || []).some(item => item.postId === postId)).toBeTruthy()

		const slide = page.locator(`#videosView .video-slide[data-post-id="${postId}"]`).first()
		await expect(slide).toBeVisible({ timeout: 30_000 })
		await expect(page.locator(`#videosView .video-slide[data-post-id="${postId}"]`)).toHaveCount(1)
		await expect(slide.locator('.video-caption')).toContainText(text)
		await expect(slide.locator('video.video-player')).toHaveAttribute('src', /flower\.mp4/)
		await expect(slide.locator('.video-author')).not.toHaveText('')
		await expect(slide.locator('.video-actions')).toBeVisible()
	})
})
