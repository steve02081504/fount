import { test, expect, openChatHub, TEST_USERNAME } from './fixtures.mjs'

test.describe('Chat shell smoke', () => {
	test('loads hub shell after apiKey login', async ({ page, baseUrl }) => {
		await openChatHub(page, baseUrl)
		await expect(page.locator('#channel-bar')).toBeVisible()
		await expect(page.locator('#hub-messages')).toBeVisible()
		await expect(page.locator('#hub-add-server-button')).toBeVisible()
	})

	test('runs against isolated test user only', async ({ baseUrl, apiKey }) => {
		expect(process.env.FOUNT_TEST_ISOLATED).toBe('1')
		const res = await fetch(`${baseUrl}/api/whoami?fount-apikey=${encodeURIComponent(apiKey)}`)
		expect(res.ok).toBe(true)
		const data = await res.json()
		expect(data.username).toBe(TEST_USERNAME)
	})

	test('redirects to login without session', async ({ browser, baseUrl }) => {
		const context = await browser.newContext()
		const page = await context.newPage()
		await page.goto(`${baseUrl}/parts/shells:chat/hub/`)
		await expect(page).toHaveURL(/\/login/)
		await context.close()
	})

	test('root URL redirects to hub', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/`)
		await expect(page).toHaveURL(/\/parts\/shells:chat\/hub\//, { timeout: 30_000 })
		await expect(page.locator('#hub-server-bar')).toBeVisible({ timeout: 30_000 })
	})
})
