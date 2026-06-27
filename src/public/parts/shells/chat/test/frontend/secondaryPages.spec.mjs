import { waitForStickersPageReady } from 'fount/scripts/test/playwright/ready.mjs'

import {
	test,
	expect,
	openFreshGroupChannel,
	sendMessageViaComposer,
	openGroupSettingsPage,
	createTestGroup,
} from './fixtures.mjs'

test.describe('Chat secondary pages', () => {
	test('history list page loads sessions', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await sendMessageViaComposer(page, groupId, channelId, `list-row ${Date.now()}`)
		await page.goto(`${baseUrl}/parts/shells:chat/list/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#sort-select')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#filter-input')).toBeVisible()
		const item = page.locator(`.chat-list-item[data-group-id="${groupId}"]`)
		await expect(item).toBeVisible({ timeout: 60_000 })
	})

	test('stickers store page loads', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/stickers/`, { waitUntil: 'domcontentloaded' })
		await waitForStickersPageReady(page)
		await expect(page.locator('#sticker-create-pack-button')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#packs-container')).toBeVisible()
		await expect(page.locator('#search-input')).toBeVisible()
	})

	test('settings page switches tabs', async ({ page, baseUrl, apiKey }) => {
		const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await openGroupSettingsPage(page, baseUrl, groupId)
		await page.locator('.tabs .tab[data-tab="members"]').click()
		await expect(page.locator('#tab-members')).toBeVisible()
		await expect(page.locator('#tab-members')).not.toHaveClass(/hidden/)
		await expect(page.locator('#members-list > div').first()).toBeVisible({ timeout: 30_000 })
	})

	test('settings permissions and emojis tabs load', async ({ page, baseUrl, apiKey }) => {
		const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await openGroupSettingsPage(page, baseUrl, groupId)
		await page.locator('.tabs .tab[data-tab="permissions"]').click()
		await expect(page.locator('#permission-settings-container #group-settings-create-role-button')).toBeVisible({ timeout: 30_000 })
		await page.locator('.tabs .tab[data-tab="channel-perms"]').click()
		await expect(page.locator('#channel-perms-container [data-action="select-channel"]').first())
			.toBeVisible({ timeout: 30_000 })
		await page.locator('.tabs .tab[data-tab="emojis"]').click()
		await expect(page.locator('#group-emojis-list')).toBeAttached({ timeout: 30_000 })
		await expect(page.locator('#group-emojis-empty')).toBeVisible({ timeout: 30_000 })
	})

	test('history list filter narrows visible sessions', async ({ page, baseUrl, apiKey }) => {
		const name = `pw-filter-${Date.now()}`
		const { groupId } = await createTestGroup(baseUrl, apiKey, { name })
		await page.goto(`${baseUrl}/parts/shells:chat/list/`, { waitUntil: 'domcontentloaded' })
		const item = page.locator(`.chat-list-item[data-group-id="${groupId}"]`)
		await expect(item).toBeVisible({ timeout: 60_000 })
		await page.locator('#filter-input').fill('__no-such-group-name__')
		await expect(item).toBeHidden({ timeout: 30_000 })
		await page.locator('#filter-input').fill(name.slice(0, 12))
		await expect(item).toBeVisible({ timeout: 30_000 })
	})

	test('history list sort select toggles order mode', async ({ page, baseUrl, apiKey }) => {
		await openFreshGroupChannel(page, baseUrl, apiKey)
		await page.goto(`${baseUrl}/parts/shells:chat/list/`, { waitUntil: 'domcontentloaded' })
		const sortSelect = page.locator('#sort-select')
		await expect(sortSelect).toHaveValue('time_desc')
		await sortSelect.selectOption('time_asc')
		await expect(sortSelect).toHaveValue('time_asc')
		await expect(page.locator('.chat-list-item').first()).toBeVisible({ timeout: 60_000 })
	})

	test('settings general tab shows group name field', async ({ page, baseUrl, apiKey }) => {
		const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await openGroupSettingsPage(page, baseUrl, groupId)
		await expect(page.locator('#save-group-settings')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#group-name, input[name="name"]').first()).toBeVisible({ timeout: 30_000 })
	})

	test('stickers page switches tabs', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/stickers/`, { waitUntil: 'domcontentloaded' })
		await waitForStickersPageReady(page)
		await expect(page.locator('.tabs .tab[data-tab="all"]')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('.tabs .tab[data-tab="all"]')).toHaveClass(/tab-active/)
		await page.locator('.tabs .tab[data-tab="my-packs"]').click()
		await expect(page.locator('.tabs .tab[data-tab="my-packs"]')).toHaveClass(/tab-active/, { timeout: 10_000 })
		await expect(page.locator('#packs-container')).toBeVisible()
	})
})
