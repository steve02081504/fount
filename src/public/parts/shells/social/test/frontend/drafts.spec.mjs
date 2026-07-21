import { test, expect, openHome } from './fixtures.mjs'

test.describe('Social composer drafts', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openHome(page, baseUrl)
	})

	test('save draft from composer and open from drafts view', async ({ page }) => {
		const text = `draft-ui ${Date.now()}`
		await page.locator('#postText').fill(text)
		const [saveRes] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/drafts')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			{ timeout: 60_000 },
			),
			page.locator('#saveDraftButton').click(),
		])
		const saved = await saveRes.json()
		expect(saved.draftId).toBeTruthy()

		await page.locator('.side-nav .nav-btn[data-view="drafts"]').click()
		await expect(page.locator('#draftsView')).toBeVisible()
		await expect(page.locator(`#draftsPanel [data-draft-id="${saved.draftId}"]`)).toBeVisible({ timeout: 20_000 })

		await page.locator(`#draftsPanel [data-open-draft="${saved.draftId}"]`).click()
		await expect(page.locator('#feedView')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('#postText')).toHaveValue(text)

		await page.locator('.side-nav .nav-btn[data-view="drafts"]').click()
		await page.locator(`#draftsPanel [data-delete-draft="${saved.draftId}"]`).click()
		await expect(page.locator(`#draftsPanel [data-draft-id="${saved.draftId}"]`)).toHaveCount(0, { timeout: 20_000 })
	})
})
