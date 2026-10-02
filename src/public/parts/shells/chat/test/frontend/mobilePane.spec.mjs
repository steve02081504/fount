import { createChatTestGroup } from 'fount/scripts/test/playwright/api.mjs'

import { test, expect, openFreshGroupChannel, waitForHub } from './fixtures.mjs'

test('list scrollbars appear during scrolling and disappear without changing list width', async ({ modulePage }) => {
	const { page } = modulePage
	await modulePage.run(async () => {
		const { bindScrollingScrollbar } = await import('/parts/shells:chat/hub/scrollbars.mjs')
		const style = document.createElement('link')
		style.rel = 'stylesheet'
		style.href = '/parts/shells:chat/hub/layout.css'
		const loaded = new Promise(resolve => style.addEventListener('load', resolve, { once: true }))
		document.head.append(style)
		const list = document.createElement('div')
		list.id = 'messages'
		list.style.cssText = 'width:240px;height:100px;overflow:auto;--text-muted:gray'
		const content = document.createElement('div')
		content.style.height = '1000px'
		list.append(content)
		document.body.append(list)
		bindScrollingScrollbar(list)
		await loaded
	})
	const list = page.locator('#messages')
	await expect(list).not.toHaveClass(/is-scrolling/)
	const width = await list.evaluate(el => el.clientWidth)
	await list.evaluate(el => { el.scrollTop = 200 })
	await expect(list).toHaveClass(/is-scrolling/)
	expect(await list.evaluate(el => el.clientWidth)).toBe(width)
	await expect(list).not.toHaveClass(/is-scrolling/)
	expect(await list.evaluate(el => el.scrollTop)).toBe(200)
	expect(await list.evaluate(el => el.clientWidth)).toBe(width)
})

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
		await expect(page.locator('#message-input')).toHaveJSProperty('disabled', false)
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
		await expect(page.locator('#overflow-search [data-i18n="chat.hub.search.aria-label"]')).toBeVisible()
		await expect(page.locator('#overflow-pins [data-i18n="chat.hub.pinsTitle"]')).toBeVisible()
		await expect(page.locator('#overflow-pins svg')).toBeVisible()
	})

	test('composer more menu opens on tap', async ({ page, baseUrl, apiKey }) => {
		await openFreshGroupChannel(page, baseUrl, apiKey)
		const more = page.locator('#composer-more-button')
		await expect(more).toBeVisible()
		await expect(more).not.toHaveAttribute('aria-disabled', 'true')
		await more.tap()
		const overflow = page.locator('details.composer-more')
		await expect(overflow).toHaveAttribute('open', '')
		await expect(page.locator('#composer-more-upload [data-i18n="chat.hub.uploadTitle.title"]')).toBeVisible()
		await expect(page.locator('#composer-more-upload svg')).toBeVisible()
	})
})
