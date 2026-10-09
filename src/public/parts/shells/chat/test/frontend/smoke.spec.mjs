import { waitForHubReady } from 'fount/scripts/test/playwright/ready.mjs'

import { test, expect, waitForHub } from './fixtures.mjs'

test.describe('Chat shell smoke', () => {
	test('aliases and groups load while viewer identity is still pending', async ({ page, baseUrl }) => {
		let releaseViewer
		const viewerGate = new Promise(resolve => { releaseViewer = resolve })
		await page.route('**/api/parts/shells:chat/viewer', async route => {
			await viewerGate
			await route.continue()
		})
		const viewerRequest = page.waitForRequest('**/api/parts/shells:chat/viewer')
		const aliasesRequest = page.waitForRequest('**/api/parts/shells:chat/aliases')
		const groupsRequest = page.waitForRequest('**/api/parts/shells:chat/groups')
		try {
			await page.goto(`${baseUrl}/parts/shells:chat/hub/`, { waitUntil: 'commit' })
			await viewerRequest
			await aliasesRequest
			await groupsRequest
		}
		finally { releaseViewer() }
		await waitForHubReady(page)
		await expect(page.locator('#friends-search-input')).toBeVisible()
		await expect(page.locator('#message-input')).toHaveJSProperty('disabled', true)
	})

	test('hub shell loads and root redirects to hub', async ({ page, baseUrl }) => {
		if (!page.url().includes('/parts/shells:chat/hub/'))
			await waitForHub(page, baseUrl)
		await expect(page.locator('#channel-bar')).toBeVisible()
		await expect(page.locator('#messages')).toBeVisible()
		await expect(page.locator('#add-server-button')).toBeVisible()

		await page.goto(`${baseUrl}/parts/shells:chat/`, { waitUntil: 'domcontentloaded' })
		await expect(page).toHaveURL(/\/parts\/shells:chat\/hub\//, { timeout: 30_000 })
		await expect(page.locator('#server-bar')).toBeVisible({ timeout: 30_000 })
	})
})
