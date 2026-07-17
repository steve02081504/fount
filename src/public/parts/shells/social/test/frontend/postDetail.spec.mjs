import { waitForSocialAppReady } from 'fount/scripts/test/playwright/ready.mjs'

import { test, expect, openSocialHome, findPostCard, fetchViewerEntityHash } from './fixtures.mjs'

test.describe('Social post detail', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
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
		await waitForSocialAppReady(page)
		await expect(page.locator('#postDetailView')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator(`#postDetailView [data-post-id="${postId}"]`)).toBeVisible()
		await expect(page.locator('#postDetailView .post-detail-replies .reply-composer')).toBeVisible()
	})
})
