import { Buffer } from 'node:buffer'

import { waitForStickersPageReady } from 'fount/scripts/test/playwright/ready.mjs'

import {
	test,
	expect,
	openFreshGroupChannel,
	sendMessageViaComposer,
	openGroupSettingsPage,
} from './fixtures.mjs'

test.describe('Chat secondary pages', () => {
	test('channel context menu exports JSON archive', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await sendMessageViaComposer(page, groupId, channelId, `archive-export ${Date.now()}`)
		const channelRow = page.locator(`.hub-channel-item[data-channel-id="${channelId}"]`)
		await expect(channelRow).toBeVisible({ timeout: 60_000 })
		const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
		await channelRow.click({ button: 'right' })
		await page.locator('.hub-channel-menu-export').click()
		const download = await downloadPromise
		expect(download.suggestedFilename()).toMatch(/\.json$/i)
	})

	test('settings page imports channel archive into new channel', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await sendMessageViaComposer(page, groupId, channelId, `archive-import ${Date.now()}`)
		const exportRes = await page.request.get(
			`${baseUrl}/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/export?fount-apikey=${encodeURIComponent(apiKey)}`,
		)
		expect(exportRes.ok()).toBeTruthy()
		const archive = await exportRes.json()
		expect(archive.format).toBe('fount-channel-archive')

		await openGroupSettingsPage(page, baseUrl, groupId)
		await page.locator('.settings-tabs > .tab[data-tab="advanced"]').click()
		await page.locator('[data-advanced-section="storage"]').click()
		await expect(page.locator('#group-settings-import-channel-archive')).toBeVisible({ timeout: 30_000 })
		await page.locator('#group-settings-import-channel-file').setInputFiles({
			name: 'channel-archive.json',
			mimeType: 'application/json',
			buffer: Buffer.from(JSON.stringify(archive), 'utf8'),
		})
		await page.waitForURL(/\/parts\/shells:chat\/hub\/#group:/, { timeout: 60_000 })
		const hash = new URL(page.url()).hash
		expect(hash).toMatch(new RegExp(`#group:${groupId}:imported_`))
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
		await expect(page.locator('.settings-tabs > .tab')).toHaveCount(4)
		await page.locator('.settings-tabs > .tab[data-tab="advanced"]').click()
		await page.locator('[data-advanced-section="permissions"]').click()
		await expect(page.locator('#permission-settings-container #group-settings-create-role-button')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#permission-settings-container')).not.toContainText('${Object.entries')
		await page.locator('[data-advanced-section="channel-perms"]').click()
		await expect(page.locator('#channel-perms-container [data-action="select-channel"]').first())
			.toBeVisible({ timeout: 30_000 })
		await page.locator('.settings-tabs > .tab[data-tab="emojis"]').click()
		await expect(page.locator('#group-emojis-list')).toBeAttached({ timeout: 30_000 })
		await expect(page.locator('#group-emojis-empty')).toBeVisible({ timeout: 30_000 })
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
