import { createChatTestGroup } from 'fount/scripts/test/playwright/api.mjs'

import { test, expect, openFreshGroupChannel, waitForHub } from './fixtures.mjs'

test.describe('Chat hub mobile pane', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

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

	test('first enter via selectGroup shows composer when main pane opens', async ({ page, baseUrl, apiKey }) => {
		const { groupId, defaultChannelId } = await createChatTestGroup(baseUrl, apiKey)
		await waitForHub(page, baseUrl)
		await expect(page.locator('body')).toHaveAttribute('data-layout-pane', 'nav')

		await page.evaluate(
			({ gid, cid }) => { location.hash = `group:${encodeURIComponent(gid)}:${cid}` },
			{ gid: groupId, cid: defaultChannelId },
		)
		await page.waitForFunction(() => document.body.dataset.layoutPane === 'main')
		const atMain = await page.evaluate(() => {
			const area = document.querySelector('.input-area')
			return {
				surface: document.body.dataset.surface,
				display: area ? getComputedStyle(area).display : 'missing',
			}
		})
		expect(atMain.surface, `composer hidden at main-pane open: ${JSON.stringify(atMain)}`).toBe('conversation')
		expect(atMain.display).not.toBe('none')
		await expect(page.locator('.input-area')).toBeVisible()
		await expect(page.locator('#message-input')).toBeEnabled()
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

	test('header overflow menu opens on tap', async ({ page, baseUrl, apiKey }) => {
		await openFreshGroupChannel(page, baseUrl, apiKey)
		const more = page.locator('#header-more-button')
		await expect(more).toBeVisible()
		await more.tap()
		const overflow = page.locator('details.header-overflow')
		await expect(overflow).toHaveAttribute('open', '')
		await expect(page.locator('#overflow-search')).toBeVisible()
		await expect(page.locator('#overflow-search')).toContainText('搜索')
		await expect(page.locator('#overflow-pins')).toContainText('置顶')
		await expect(page.locator('#overflow-pins img')).toBeVisible()
	})

	test('composer more menu opens on tap', async ({ page, baseUrl, apiKey }) => {
		await openFreshGroupChannel(page, baseUrl, apiKey)
		const more = page.locator('#composer-more-button')
		await expect(more).toBeVisible()
		await expect(more).not.toHaveAttribute('aria-disabled', 'true')
		await more.tap()
		const overflow = page.locator('details.composer-more')
		await expect(overflow).toHaveAttribute('open', '')
		await expect(page.locator('#composer-more-upload')).toBeVisible()
		await expect(page.locator('#composer-more-upload')).toContainText('上传文件')
		await expect(page.locator('#composer-more-upload img')).toBeVisible()
	})
})
