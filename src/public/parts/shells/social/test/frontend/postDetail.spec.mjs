import { waitForSocialReady } from 'fount/scripts/test/playwright/ready.mjs'

import { test, expect, openHome, findPostCard, fetchViewerEntityHash } from './fixtures.mjs'

test.describe('Social post detail', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openHome(page, baseUrl)
	})

	test('opens post detail from time link and deep hash', async ({ page, baseUrl, publishPost, apiKey }) => {
		const { postId } = await publishPost(`detail-target ${Date.now()}`)
		const card = await findPostCard(page, postId)
		await card.locator('.post-time-link').click()
		await expect(page.locator('#postDetailView')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator(`#postDetailView [data-post-id="${postId}"]`)).toBeVisible()
		await expect(page).toHaveURL(/#post;/)

		const entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		await page.goto(`${baseUrl}/parts/shells:social/#post;${entityHash};${postId}`)
		await waitForSocialReady(page)
		await expect(page.locator('#postDetailView')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator(`#postDetailView [data-post-id="${postId}"]`)).toBeVisible()
		await expect(page.locator('#postDetailView .post-detail-replies .reply-composer')).toBeVisible()
	})

	test('restores post-detail reading progress across reloads', async ({ page, baseUrl, apiKey, publishPost }) => {
		await page.addInitScript(() => { history.scrollRestoration = 'manual' })
		const body = Array.from({ length: 60 }, (_, index) => `阅读进度第 ${index + 1} 行，用于撑高帖子详情页。`).join('\n\n')
		const { postId } = await publishPost(body)
		const entityHash = await fetchViewerEntityHash(baseUrl, apiKey)

		await page.goto(`${baseUrl}/parts/shells:social/#post;${entityHash};${postId}`)
		await waitForSocialReady(page)
		const paragraphs = page.locator('#postDetailView .body.markdown-body > p')
		await expect(paragraphs.nth(39)).toBeVisible({ timeout: 30_000 })

		// 首屏恢复（无记录）绑定完成后滚到第 40 段并等待节流保存
		await page.waitForTimeout(1000)
		await paragraphs.nth(39).evaluate(element => element.scrollIntoView({ block: 'start' }))
		await expect.poll(async () => {
			const response = await page.request.get(
				`${baseUrl}/api/parts/shells:social/read-progress/${entityHash}/${postId}`,
				{ headers: { 'fount-apikey': apiKey } },
			)
			if (!response.ok()) return -1
			const { progress } = await response.json()
			return progress?.anchor?.blockIndex ?? -1
		}, { timeout: 10_000 }).toBeGreaterThanOrEqual(39)

		// 换到空白页再回到同一详情页，避免浏览器自身滚动恢复造成的假阳性
		await page.goto('about:blank')
		await page.goto(`${baseUrl}/parts/shells:social/#post;${entityHash};${postId}`)
		await waitForSocialReady(page)
		await expect(paragraphs.nth(39)).toBeVisible({ timeout: 30_000 })
		await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 30_000 }).toBeGreaterThan(200)
		const restoredTop = await paragraphs.nth(39).evaluate(element => Math.round(element.getBoundingClientRect().top))
		expect(Math.abs(restoredTop)).toBeLessThan(160)
	})
})
