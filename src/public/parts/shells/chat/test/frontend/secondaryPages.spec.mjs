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
		await page.locator('.settings-nav-item[data-section="storage"]').click()
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

	test('settings page switches sections', async ({ page, baseUrl, apiKey }) => {
		const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await openGroupSettingsPage(page, baseUrl, groupId)
		const membersNav = page.locator('.settings-nav-item[data-section="members"]')
		await membersNav.click()
		await expect(membersNav).toHaveAttribute('aria-selected', 'true')
		await expect(page.locator('#panel-members')).toBeVisible()
		await expect(page.locator('#panel-members')).not.toHaveAttribute('hidden', '')
		await expect(page.locator('#members-list .settings-member-row').first()).toBeVisible({ timeout: 30_000 })
	})

	test('settings permissions and emojis sections load', async ({ page, baseUrl, apiKey }) => {
		const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await openGroupSettingsPage(page, baseUrl, groupId)
		await expect(page.locator('.settings-nav-item:not(.hidden)')).toHaveCount(7)
		await expect(page.locator('.settings-nav-item[data-section="general"]')).toHaveAttribute('aria-selected', 'true')

		await page.locator('.settings-nav-item[data-section="permissions"]').click()
		await expect(page.locator('#permission-settings-container #group-settings-create-role-button')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#permission-settings-container')).not.toContainText('${Object.entries')
		await expect(page.locator('#permission-settings-container .settings-role').first()).toBeVisible()

		await page.locator('.settings-nav-item[data-section="channel-perms"]').click()
		await expect(page.locator('#channel-perms-container [data-action="select-channel"]').first())
			.toBeVisible({ timeout: 30_000 })

		await page.locator('.settings-nav-item[data-section="emojis"]').click()
		await expect(page.locator('#group-emojis-list')).toBeAttached({ timeout: 30_000 })
		await expect(page.locator('#group-emojis-empty')).toBeVisible({ timeout: 30_000 })
	})

	test('settings general section shows group name field', async ({ page, baseUrl, apiKey }) => {
		const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await openGroupSettingsPage(page, baseUrl, groupId)
		await expect(page.locator('#save-group-settings')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#group-name')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('.settings-advanced').first()).not.toHaveAttribute('open', '')
		await expect(page.locator('#max-dag-payload-bytes')).toBeHidden()
	})

	test('settings page saves group name via meta API', async ({ page, baseUrl, apiKey }) => {
		const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await openGroupSettingsPage(page, baseUrl, groupId)
		const nextName = `pw-settings-${Date.now()}`
		await page.locator('#group-name').fill(nextName)
		const metaResponsePromise = page.waitForResponse(response =>
			response.url().includes(`/groups/${encodeURIComponent(groupId)}/meta`)
			&& response.request().method() === 'PUT'
		)
		const settingsResponsePromise = page.waitForResponse(response =>
			response.url().includes(`/groups/${encodeURIComponent(groupId)}/settings`)
			&& response.request().method() === 'PUT'
		)
		await page.locator('#save-group-settings').click()
		const metaResponse = await metaResponsePromise
		expect(metaResponse.ok()).toBeTruthy()
		const metaBody = metaResponse.request().postDataJSON()
		expect(metaBody.name).toBe(nextName)
		expect((await settingsResponsePromise).ok()).toBeTruthy()
		await expect(page.locator('#group-name')).toHaveValue(nextName, { timeout: 30_000 })
	})

	test('settings page toggles role permission via API', async ({ page, baseUrl, apiKey }) => {
		const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await openGroupSettingsPage(page, baseUrl, groupId)
		await page.locator('.settings-nav-item[data-section="permissions"]').click()
		const role = page.locator('#permission-settings-container .settings-role').filter({ hasText: 'Everyone' }).first()
		await expect(role).toBeVisible({ timeout: 30_000 })
		await role.locator('summary').click()
		const checkbox = role.locator('[data-action="update-permission"][data-role-id="@everyone"][data-perm="SEND_MESSAGES"]')
		await expect(checkbox).toBeVisible()
		const nextChecked = !await checkbox.isChecked()
		const responsePromise = page.waitForResponse(response =>
			response.url().includes(`/groups/${encodeURIComponent(groupId)}/roles/`)
			&& response.url().includes('/permissions')
			&& response.request().method() === 'PUT'
		)
		await checkbox.setChecked(nextChecked)
		const response = await responsePromise
		expect(response.ok()).toBeTruthy()
		const body = response.request().postDataJSON()
		expect(body.permission).toBe('SEND_MESSAGES')
		expect(body.enabled).toBe(nextChecked)
	})

	test('settings nav becomes horizontal on narrow viewport', async ({ page, baseUrl, apiKey }) => {
		const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await openGroupSettingsPage(page, baseUrl, groupId)
		await page.setViewportSize({ width: 480, height: 800 })
		const nav = page.locator('.settings-nav')
		await expect(nav).toBeVisible()
		const layout = await nav.evaluate(el => {
			const styles = getComputedStyle(el)
			return {
				flexDirection: styles.flexDirection,
				overflowX: styles.overflowX,
			}
		})
		expect(layout.flexDirection).toBe('row')
		expect(layout.overflowX).toBe('auto')
		await page.locator('.settings-nav-item[data-section="members"]').click()
		await expect(page.locator('#panel-members')).toBeVisible()
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
