import {
	test,
	expect,
	openCabinet,
	createFolderViaApi,
} from './fixtures.mjs'

test.describe('Cabinet shortcuts', () => {
	test('Ctrl+A selects, Ctrl+D deletes, Ctrl+Z restores', async ({ page, baseUrl, apiKey }) => {
		const folder = await createFolderViaApi(baseUrl, apiKey, `pw-del-${Date.now()}`)
		await openCabinet(page, baseUrl, folder.cabinet_id)
		const card = page.locator(`.entry-card[data-id="${folder.id}"]`)
		await expect(card).toBeVisible({ timeout: 30_000 })
		await card.click({ modifiers: ['Control'] })
		await expect(card).toHaveClass(/selected/)
		await page.keyboard.press('Control+a')
		page.once('dialog', dialog => dialog.accept())
		await page.keyboard.press('Control+d')
		await expect(page.locator(`.entry-card[data-id="${folder.id}"]`)).toHaveCount(0, { timeout: 30_000 })
		await page.keyboard.press('Control+z')
		await expect(page.locator(`.entry-card[data-id="${folder.id}"]`)).toBeVisible({ timeout: 30_000 })
	})

	test('Delete key goes to parent folder', async ({ page, baseUrl, apiKey }) => {
		const folder = await createFolderViaApi(baseUrl, apiKey, `pw-up-${Date.now()}`)
		await openCabinet(page, baseUrl, folder.cabinet_id)
		await page.goto(`${baseUrl}/parts/shells:cabinet/#cabinet:${folder.cabinet_id}/${folder.id}`, {
			waitUntil: 'domcontentloaded',
		})
		await expect(page.locator('#breadcrumb .breadcrumb-current')).toContainText(folder.name, { timeout: 30_000 })
		await page.keyboard.press('Delete')
		await expect(page).toHaveURL(new RegExp(`#cabinet:${folder.cabinet_id}$`), { timeout: 30_000 })
	})

	test('Ctrl+N opens current location in new window', async ({ page, baseUrl, apiKey, context }) => {
		const folder = await createFolderViaApi(baseUrl, apiKey, `pw-win-${Date.now()}`)
		await openCabinet(page, baseUrl, folder.cabinet_id)
		await page.goto(`${baseUrl}/parts/shells:cabinet/#cabinet:${folder.cabinet_id}/${folder.id}`, {
			waitUntil: 'domcontentloaded',
		})
		await expect(page.locator('#breadcrumb .breadcrumb-current')).toContainText(folder.name, { timeout: 30_000 })
		const popupPromise = context.waitForEvent('page')
		await page.keyboard.press('Control+n')
		const popup = await popupPromise
		await expect(popup).toHaveURL(new RegExp(`#cabinet:${folder.cabinet_id}/${folder.id}`), { timeout: 30_000 })
		await popup.close()
	})

	test('copy paste via Ctrl+C/V creates a copy', async ({ page, baseUrl, apiKey }) => {
		const folder = await createFolderViaApi(baseUrl, apiKey, `pw-copy-${Date.now()}`)
		await openCabinet(page, baseUrl, folder.cabinet_id)
		const card = page.locator(`.entry-card[data-id="${folder.id}"]`)
		await expect(card).toBeVisible({ timeout: 30_000 })
		await card.click({ modifiers: ['Control'] })
		await expect(card).toHaveClass(/selected/)
		await page.keyboard.press('Control+c')
		await page.keyboard.press('Control+v')
		await expect(page.locator('.entry-card', { hasText: `${folder.name} (copy)` })).toBeVisible({ timeout: 30_000 })
	})
})
