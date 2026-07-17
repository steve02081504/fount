import { test, expect } from './fixtures.mjs'

test.describe('Chat profile page', () => {
	test('profile page and hub profile link', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/profile`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#profile-card-host [data-entity-profile-avatar]')).toBeVisible()
		await expect(page.locator('.profile-owner-details')).not.toHaveAttribute('open', '')

		await page.goto(`${baseUrl}/parts/shells:chat/hub/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#hub-server-bar')).toBeVisible({ timeout: 60_000 })
		await page.locator('.hub-user-settings-link').click()
		await expect(page).toHaveURL(/\/parts\/shells:chat\/profile/, { timeout: 30_000 })
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
	})

	test('profile edit opens modal', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/profile`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#profile-card-host [data-entity-profile-name]')).not.toBeEmpty({ timeout: 30_000 })
		await page.locator('#profile-edit-button').click()
		await expect(page.locator('#hub-profile-edit-modal')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('#hub-profile-edit-live-preview')).toBeVisible()
		await page.locator('#hub-profile-edit-name').fill('实时预览名称')
		await expect(page.locator('#hub-profile-edit-live-preview [data-entity-profile-name]')).toHaveText('实时预览名称')
		await page.locator('#hub-profile-edit-new-locale-code').fill('x-copy-test')
		await page.locator('#hub-profile-edit-locale-add').click()
		await expect(page.locator('#hub-profile-edit-name')).toHaveValue('实时预览名称')
		await expect(page.locator('.hub-profile-locale-tab[data-locale="x-copy-test"]')).toBeVisible()
		await page.locator('#hub-profile-edit-locale-code').fill('x-renamed-test')
		await page.locator('#hub-profile-edit-locale-rename').click()
		await expect(page.locator('.hub-profile-locale-tab[data-locale="x-renamed-test"]')).toBeVisible()
		await expect(page.locator('.hub-profile-locale-tab[data-locale="x-copy-test"]')).toHaveCount(0)
		await page.locator('#hub-profile-edit-cancel').click()
		await expect(page.locator('#hub-profile-edit-modal')).toBeHidden({ timeout: 10_000 })
	})

	test('structured tags links and banner controls', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/profile`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#profile-card-host [data-entity-profile-name]')).not.toBeEmpty({ timeout: 30_000 })
		await page.locator('#profile-edit-button').click()
		await expect(page.locator('#hub-profile-edit-modal')).toBeVisible({ timeout: 20_000 })

		await expect(page.locator('#hub-profile-edit-banner-upload')).toBeVisible()
		await expect(page.locator('#hub-profile-edit-avatar-url')).toBeVisible()
		await expect(page.locator('#hub-profile-edit-banner-url')).toBeVisible()
		await expect(page.locator('#hub-profile-edit-banner-clear')).toBeVisible()
		await expect(page.locator('#hub-profile-edit-tags')).toBeVisible()
		await expect(page.locator('#hub-profile-edit-links')).toBeVisible()
		await expect(page.locator('#hub-profile-edit-links textarea')).toHaveCount(0)

		await page.locator('#hub-profile-edit-tag-input').fill('原创')
		await page.locator('#hub-profile-edit-tag-add').click()
		await expect(page.locator('#hub-profile-edit-tags .hub-profile-edit-tag-chip')).toContainText('#原创')
		await expect(page.locator('#hub-profile-edit-live-preview [data-entity-profile-tags]')).toContainText('#原创')

		const firstRow = page.locator('#hub-profile-edit-links .hub-profile-edit-link-row').first()
		await firstRow.locator('input').nth(0).fill('示例站')
		await firstRow.locator('input').nth(1).fill('https://example.com')
		await expect(page.locator('#hub-profile-edit-live-preview [data-entity-profile-links] a')).toHaveAttribute('href', 'https://example.com/')
		await expect(page.locator('#hub-profile-edit-live-preview [data-entity-profile-links] a')).toHaveText('示例站')

		await page.locator('#hub-profile-edit-link-add').click()
		await expect(page.locator('#hub-profile-edit-links .hub-profile-edit-link-row')).toHaveCount(2)

		const { Buffer } = await import('node:buffer')
		const tinyPng = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
			'base64',
		)
		const tinyPngUrl = `data:image/png;base64,${tinyPng.toString('base64')}`
		await page.locator('#hub-profile-edit-avatar-url').fill(tinyPngUrl)
		await expect(page.locator('#hub-profile-edit-avatar-swatch img')).toHaveAttribute('src', tinyPngUrl)
		await page.locator('#hub-profile-edit-banner-url').fill(tinyPngUrl)
		await expect
			.poll(async () => page.locator('#hub-profile-edit-live-preview .hub-profile-popup-banner')
				.evaluate(el => el.classList.contains('hub-profile-popup-banner--image')))
			.toBe(true)
		await page.locator('#hub-profile-edit-banner-upload').setInputFiles({
			name: 'banner.png',
			mimeType: 'image/png',
			buffer: tinyPng,
		})
		await expect
			.poll(async () => page.locator('#hub-profile-edit-live-preview .hub-profile-popup-banner')
				.evaluate(el => el.classList.contains('hub-profile-popup-banner--image')))
			.toBe(true)

		await page.locator('#hub-profile-edit-banner-clear').click()
		await expect
			.poll(async () => page.locator('#hub-profile-edit-live-preview .hub-profile-popup-banner')
				.evaluate(el => el.classList.contains('hub-profile-popup-banner--image')))
			.toBe(false)

		await page.locator('#hub-profile-edit-save').click()
		await expect(page.locator('#hub-profile-edit-modal')).toBeHidden({ timeout: 20_000 })
		await expect(page.locator('#profile-card-host [data-entity-profile-tags]')).toContainText('#原创', { timeout: 20_000 })
		await expect(page.locator('#profile-card-host [data-entity-profile-links] a')).toHaveText('示例站')
		await expect(page.locator('#profile-card-host [data-entity-profile-links] a')).toHaveAttribute('href', 'https://example.com/')
	})
})
