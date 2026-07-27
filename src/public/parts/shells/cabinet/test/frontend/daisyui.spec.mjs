import {
	test,
	expect,
	openCabinet,
	createFolderViaApi,
} from './fixtures.mjs'

test.describe('Cabinet DaisyUI chrome', () => {
	test('entry selection uses aria-selected and card chrome', async ({ page, baseUrl, apiKey }) => {
		const folder = await createFolderViaApi(baseUrl, apiKey, `pw-sel-${Date.now()}`)
		await openCabinet(page, baseUrl, folder.cabinet_id)
		const card = page.locator(`.entry-card[data-id="${folder.id}"]`)
		await expect(card).toBeVisible({ timeout: 30_000 })
		await expect(card).toHaveClass(/card/)
		await card.click({ modifiers: ['Control'] })
		await expect(card).toHaveAttribute('aria-selected', 'true')
		await expect(card).toHaveClass(/ring-primary/)
	})

	test('breadcrumbs and cabinet menu use DaisyUI structures', async ({ page, baseUrl, apiKey }) => {
		const folder = await createFolderViaApi(baseUrl, apiKey, `pw-crumb-${Date.now()}`)
		await openCabinet(page, baseUrl, folder.cabinet_id)
		await page.goto(`${baseUrl}/parts/shells:cabinet/#cabinet:${folder.cabinet_id}/${folder.id}`, {
			waitUntil: 'domcontentloaded',
		})
		const breadcrumb = page.locator('#breadcrumb')
		await expect(breadcrumb).toHaveClass(/breadcrumbs/)
		await expect(breadcrumb.locator('.breadcrumb-current')).toContainText(folder.name, { timeout: 30_000 })
		await expect(page.locator('#cabinetList .menu-active')).toHaveCount(1)
	})

	test('context menu opens as menu and rename uses modal dialog', async ({ page, baseUrl, apiKey }) => {
		const folder = await createFolderViaApi(baseUrl, apiKey, `pw-menu-${Date.now()}`)
		await openCabinet(page, baseUrl, folder.cabinet_id)
		const card = page.locator(`.entry-card[data-id="${folder.id}"]`)
		await expect(card).toBeVisible({ timeout: 30_000 })
		await card.click({ button: 'right' })
		const menu = page.locator('#contextMenu[role="menu"]')
		await expect(menu).toBeVisible({ timeout: 10_000 })
		await expect(menu.locator('hr').first()).toBeVisible()
		await menu.getByRole('menuitem').filter({ hasText: /重命名|Rename/i }).click()
		const dialog = page.locator('dialog.modal[open]')
		await expect(dialog).toBeVisible({ timeout: 10_000 })
		await expect(dialog.locator('.modal-box')).toBeVisible()
		await expect(dialog.locator('#promptInput, input.input')).toBeVisible()
		await dialog.locator('[data-dialog-cancel]').click()
		await expect(page.locator('dialog.modal[open]')).toHaveCount(0, { timeout: 10_000 })
	})

	test('mobile drawer toggle is present under narrow viewport', async ({ page, baseUrl, apiKey }) => {
		const folder = await createFolderViaApi(baseUrl, apiKey, `pw-drawer-${Date.now()}`)
		await page.setViewportSize({ width: 390, height: 844 })
		await openCabinet(page, baseUrl, folder.cabinet_id)
		await expect(page.locator('.drawer')).toBeVisible()
		const toggle = page.locator('label[for="cabinet-drawer-toggle"]').first()
		await expect(toggle).toBeVisible()
		await toggle.click()
		await expect(page.locator('#cabinet-drawer-toggle')).toBeChecked()
	})
})
