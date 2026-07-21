import { waitForSocialReady } from 'fount/scripts/test/playwright/ready.mjs'

import {
	test,
	expect,
	openHome,
	fetchViewerEntityHash,
} from './fixtures.mjs'

test.describe('Social deep links', () => {
	test('hash search opens search view', async ({ page, baseUrl, publishPost }) => {
		await openHome(page, baseUrl)
		const tag = `hashsearch${Date.now()}`
		const { postId } = await publishPost(`hash link #${tag}`)
		await page.goto(`${baseUrl}/parts/shells:social/#search;${encodeURIComponent(tag)}`)
		await waitForSocialReady(page)
		await expect(page.locator('#searchView')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#feedSearchClearButton')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator(`#searchViewResults [data-post-id="${postId}"]`).first()).toBeVisible({
			timeout: 30_000,
		})
	})

	test('query param q opens search with target post', async ({ page, baseUrl, publishPost }) => {
		await openHome(page, baseUrl)
		const tag = `qparam${Date.now()}`
		const { postId } = await publishPost(`query search #${tag}`)
		await page.goto(`${baseUrl}/parts/shells:social/?q=${encodeURIComponent(`#${tag}`)}`)
		await waitForSocialReady(page)
		await expect(page.locator('#searchView')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#feedSearchClearButton')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator(`#searchViewResults [data-post-id="${postId}"]`).first()).toBeVisible({
			timeout: 30_000,
		})
	})

	test('profile hash without post id', async ({ page, baseUrl, apiKey }) => {
		const entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		const [, profileResponse] = await Promise.all([
			page.goto(`${baseUrl}/parts/shells:social/#profile;${entityHash}`),
			page.waitForResponse(res =>
				res.url().includes(`/api/parts/shells:social/profile/${entityHash}`)
				&& res.request().method() === 'GET'
				&& res.status() === 200,
			),
		])
		expect(profileResponse.ok()).toBe(true)
		await waitForSocialReady(page)
		await expect(page.locator('#profileView .profile-header')).toBeVisible({ timeout: 30_000 })
	})

	test('hashchange navigates to search', async ({ page, baseUrl, publishPost }) => {
		await openHome(page, baseUrl)
		const tag = `hashchg${Date.now()}`
		await publishPost(`hash change #${tag}`)
		await page.evaluate(query => {
			location.hash = `search;${encodeURIComponent(query)}`
		}, tag)
		await expect(page.locator('#searchView')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#feedSearchClearButton')).toBeVisible({ timeout: 30_000 })
	})
})
