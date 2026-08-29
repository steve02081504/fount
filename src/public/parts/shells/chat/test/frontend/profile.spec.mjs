import { test, expect, waitForHub } from './fixtures.mjs'

test.describe('Chat profile page', () => {
	test('profile page and hub profile link', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/profile`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#profile-card-host [data-entity-profile-avatar]')).toBeVisible()
		await expect(page.locator('#profile-federation-settings')).toHaveCount(0)
		await expect(page.locator('.profile-owner-details')).toBeVisible()
		await expect(page.locator('.profile-owner-details')).not.toHaveAttribute('open', '')

		await waitForHub(page, baseUrl)
		await page.locator('#user-bar').click()
		await expect(page.locator('[data-profile-link]')).toBeVisible({ timeout: 20_000 })
		await page.locator('[data-profile-link]').click()
		await expect(page).toHaveURL(/\/parts\/shells:chat\/profile/, { timeout: 30_000 })
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
	})

	test('profile edit opens modal', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/profile`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#profile-card-host [data-entity-profile-name]')).not.toBeEmpty({ timeout: 30_000 })
		await page.locator('#profile-edit-button').click()
		await expect(page.locator('#profile-edit-modal')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('#profile-edit-live-preview')).toBeVisible()
		await page.locator('#profile-edit-name').fill('live preview name')
		await expect(page.locator('#profile-edit-live-preview [data-entity-profile-name]')).toHaveText('live preview name')
		await page.locator('.profile-locale-add-input').fill('x-copy-test')
		await page.locator('.profile-locale-add-input').press('Enter')
		await expect(page.locator('#profile-edit-name')).toHaveValue('live preview name')
		await expect(page.locator('.profile-locale-tab[data-locale="x-copy-test"]')).toBeVisible()
		await page.locator('.profile-locale-tab[data-locale="x-copy-test"] .profile-locale-tab-label').click()
		await page.locator('.profile-locale-tab-edit').fill('x-renamed-test')
		await page.locator('.profile-locale-tab-edit').press('Enter')
		await expect(page.locator('.profile-locale-tab[data-locale="x-renamed-test"]')).toBeVisible()
		await expect(page.locator('.profile-locale-tab[data-locale="x-copy-test"]')).toHaveCount(0)
		await page.locator('#profile-edit-cancel').click()
		await expect(page.locator('#profile-edit-modal')).toBeHidden({ timeout: 10_000 })
	})

	test('structured tags links and banner controls', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/profile`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#profile-card-host [data-entity-profile-name]')).not.toBeEmpty({ timeout: 30_000 })
		await page.locator('#profile-edit-button').click()
		await expect(page.locator('#profile-edit-modal')).toBeVisible({ timeout: 20_000 })

		await expect(page.locator('#profile-edit-banner-upload')).toBeVisible()
		await expect(page.locator('#profile-edit-avatar-url')).toBeVisible()
		await expect(page.locator('#profile-edit-banner-url')).toBeVisible()
		await expect(page.locator('#profile-edit-banner-clear')).toBeVisible()
		await expect(page.locator('#profile-edit-tags')).toBeVisible()
		await expect(page.locator('#profile-edit-links')).toBeVisible()
		await expect(page.locator('#profile-edit-links textarea')).toHaveCount(0)

		await expect(page.locator('#profile-edit-color-swatch')).not.toHaveClass(/has-color/)
		await page.locator('#profile-edit-theme-color').fill('#a01bff')
		await expect(page.locator('#profile-edit-color-swatch')).toHaveClass(/has-color/)
		await page.locator('#profile-edit-theme-color-clear').click()
		await expect(page.locator('#profile-edit-color-swatch')).not.toHaveClass(/has-color/)

		await page.locator('#profile-edit-tag-input').fill('original')
		await page.locator('#profile-edit-tag-add').click()
		await expect(page.locator('#profile-edit-tags .profile-edit-tag-chip')).toContainText('#original')
		await expect(page.locator('#profile-edit-live-preview [data-entity-profile-tags]')).toContainText('#original')

		await page.locator('#profile-edit-tag-input').fill('#男 #萝莉控 #游手好闲')
		await page.locator('#profile-edit-tag-add').click()
		await expect(page.locator('#profile-edit-tags .profile-edit-tag-chip')).toHaveCount(4)
		for (const tag of ['男', '萝莉控', '游手好闲']) 
			await expect(page.locator('#profile-edit-tags .profile-edit-tag-chip').filter({ hasText: `#${tag}` })).toHaveCount(1)
		
		await expect(page.locator('#profile-edit-live-preview [data-entity-profile-tags]')).toContainText('#萝莉控')

		const firstRow = page.locator('#profile-edit-links .profile-edit-link-row').first()
		await firstRow.locator('input').nth(0).fill('Example Site')
		await firstRow.locator('input').nth(1).fill('https://example.com')
		await expect(page.locator('#profile-edit-live-preview [data-entity-profile-links] a')).toHaveAttribute('href', 'https://example.com/')
		await expect(page.locator('#profile-edit-live-preview [data-entity-profile-links] a')).toHaveText('Example Site')

		await page.locator('#profile-edit-link-add').click()
		await expect(page.locator('#profile-edit-links .profile-edit-link-row')).toHaveCount(2)

		const secondRow = page.locator('#profile-edit-links .profile-edit-link-row').nth(1)
		await secondRow.locator('input').nth(1).fill('https://github.com/steve02081504')
		await expect(secondRow.locator('input').nth(0)).toHaveValue('github')
		await expect(page.locator('#profile-edit-live-preview [data-entity-profile-links] a').last()).toHaveText('github')

		const { Buffer } = await import('node:buffer')
		const tinyPng = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
			'base64',
		)
		const tinyPngUrl = `data:image/png;base64,${tinyPng.toString('base64')}`
		await page.locator('#profile-edit-avatar-url').fill(tinyPngUrl)
		await expect(page.locator('#profile-edit-avatar-swatch img')).toHaveAttribute('src', tinyPngUrl)
		await page.locator('#profile-edit-banner-url').fill(tinyPngUrl)
		await expect
			.poll(async () => page.locator('#profile-edit-live-preview .profile-popup-banner')
				.evaluate(el => el.classList.contains('profile-popup-banner--image')))
			.toBe(true)
		await page.locator('#profile-edit-banner-upload').setInputFiles({
			name: 'banner.png',
			mimeType: 'image/png',
			buffer: tinyPng,
		})
		await expect
			.poll(async () => page.locator('#profile-edit-live-preview .profile-popup-banner')
				.evaluate(el => el.classList.contains('profile-popup-banner--image')))
			.toBe(true)

		await page.locator('#profile-edit-banner-clear').click()
		await expect
			.poll(async () => page.locator('#profile-edit-live-preview .profile-popup-banner')
				.evaluate(el => el.classList.contains('profile-popup-banner--image')))
			.toBe(false)

		await page.locator('#profile-edit-save').click()
		await expect(page.locator('#profile-edit-modal')).toBeHidden({ timeout: 20_000 })
		await expect(page.locator('#profile-card-host [data-entity-profile-tags]')).toContainText('#original', { timeout: 20_000 })
		await expect(page.locator('#profile-card-host [data-entity-profile-links] a')).toHaveText('Example Site')
		await expect(page.locator('#profile-card-host [data-entity-profile-links] a')).toHaveAttribute('href', 'https://example.com/')
	})
})

test.describe('Chat profile edit mobile', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

	test('save button stays fully inside modal and commits', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/profile`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#profile-card-host [data-entity-profile-name]')).not.toBeEmpty({ timeout: 30_000 })
		await page.locator('#profile-edit-button').click()
		await expect(page.locator('#profile-edit-modal')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('#profile-edit-save')).toBeVisible()

		const geometry = await page.locator('.profile-edit-box').evaluate((box) => {
			const save = box.querySelector('#profile-edit-save')
			const boxRect = box.getBoundingClientRect()
			const saveRect = save.getBoundingClientRect()
			const tolerance = 0.5
			return {
				fullyInsideBox:
					saveRect.top >= boxRect.top - tolerance
					&& saveRect.bottom <= boxRect.bottom + tolerance
					&& saveRect.left >= boxRect.left - tolerance
					&& saveRect.right <= boxRect.right + tolerance,
				fullyInViewport:
					saveRect.top >= -tolerance
					&& saveRect.bottom <= window.innerHeight + tolerance
					&& saveRect.left >= -tolerance
					&& saveRect.right <= window.innerWidth + tolerance,
				boxBottom: boxRect.bottom,
				saveBottom: saveRect.bottom,
				viewportHeight: window.innerHeight,
				viewportWidth: window.innerWidth,
				saveLeft: saveRect.left,
				saveRight: saveRect.right,
			}
		})
		expect(geometry.fullyInsideBox, `save clipped by modal-box (boxBottom=${geometry.boxBottom}, saveBottom=${geometry.saveBottom})`).toBe(true)
		expect(geometry.fullyInViewport, `save outside viewport (vh=${geometry.viewportHeight}, vw=${geometry.viewportWidth}, saveLeft=${geometry.saveLeft}, saveRight=${geometry.saveRight}, saveBottom=${geometry.saveBottom})`).toBe(true)

		const nextName = `mobile-save-${Date.now()}`
		await page.locator('#profile-edit-sfw-mode').uncheck()
		await page.locator('#profile-edit-name').fill(nextName)
		await page.locator('#profile-edit-save').click({ trial: true })
		await page.locator('#profile-edit-save').click()
		await expect(page.locator('#profile-edit-modal')).toBeHidden({ timeout: 20_000 })
		await expect(page.locator('#profile-card-host [data-entity-profile-name]')).toHaveText(nextName, { timeout: 20_000 })
	})
})
