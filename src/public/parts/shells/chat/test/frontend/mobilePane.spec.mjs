import { test, expect, openFreshGroupChannel } from './fixtures.mjs'

test.describe('Chat hub mobile pane', () => {
	test.use({ viewport: { width: 390, height: 844 } })

	test('nav and main panes swap without horizontal overflow', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await expect(page.locator('body')).toHaveAttribute('data-layout-pane', 'main')
		await expect(page.locator('.main')).toBeVisible()
		await expect(page.locator('#server-bar')).toBeHidden()
		await expect(page.locator('#channel-bar')).toBeHidden()
		await expect(page.locator('#top-back-button')).toBeVisible()
		await expect(page.locator('#composer-more-button')).toBeVisible()
		await expect(page.locator('#header-more-button')).toBeVisible()

		const mainOverflow = await page.evaluate(() => ({
			vw: window.innerWidth,
			body: document.body.scrollWidth,
		}))
		expect(mainOverflow.body).toBeLessThanOrEqual(mainOverflow.vw + 1)

		await page.locator('#top-back-button').click()
		await expect(page.locator('body')).toHaveAttribute('data-layout-pane', 'nav')
		await expect(page.locator('#server-bar')).toBeVisible()
		await expect(page.locator('#channel-bar')).toBeVisible()
		await expect(page.locator('.main')).toBeHidden()

		const navOverflow = await page.evaluate(() => ({
			vw: window.innerWidth,
			body: document.body.scrollWidth,
		}))
		expect(navOverflow.body).toBeLessThanOrEqual(navOverflow.vw + 1)

		await page.locator(`.channel-item[data-channel-id="${channelId}"]`).click()
		await expect(page.locator('body')).toHaveAttribute('data-layout-pane', 'main')
		await expect(page.locator('.main')).toBeVisible()
		await expect(page).toHaveURL(new RegExp(`group:${groupId}:${channelId}`))
	})

	test('member backdrop closes member overlay', async ({ page, baseUrl, apiKey }) => {
		await openFreshGroupChannel(page, baseUrl, apiKey)
		await page.locator('#toggle-members-button').click()
		await expect(page.locator('#member-bar')).toHaveClass(/member-bar--open/)
		await expect(page.locator('#member-backdrop')).toBeVisible()
		// 成员栏盖住右侧；点左侧露出的 backdrop
		await page.locator('#member-backdrop').click({ position: { x: 16, y: 200 } })
		await expect(page.locator('#member-bar')).not.toHaveClass(/member-bar--open/)
	})
})
