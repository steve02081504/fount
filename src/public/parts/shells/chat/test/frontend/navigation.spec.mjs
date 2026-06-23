import {
	test,
	expect,
	waitForHubShell,
	openFreshGroupChannel,
	openGroupChannel,
	createGroupViaHubUi,
	createTestChannel,
	openGroupSettingsPage,
} from './fixtures.mjs'

test.describe('Chat hub navigation', () => {
	test('switches between groups and friends mode', async ({ page, baseUrl }) => {
		await waitForHubShell(page, baseUrl)
		await page.locator('.hub-server-item[data-mode="friends"]').click()
		await expect(page.locator('#hub-message-input')).toBeDisabled({ timeout: 60_000 })
		await expect(page).toHaveURL(/#friends/)
		await page.locator('.hub-server-item[data-mode="groups"]').click()
		await expect(page.locator('#hub-channel-list')).toBeVisible()
	})

	test('creates a group via hub UI', async ({ page, baseUrl }) => {
		const { groupId, channelId } = await createGroupViaHubUi(page, baseUrl, {
			name: `pw-nav-ui-${Date.now()}`,
		})
		expect(groupId).toBeTruthy()
		expect(channelId).toBeTruthy()
		await expect(page.locator('#hub-channel-list .hub-channel-item')).toHaveCount(1, { timeout: 30_000 })
	})

	test('switches between channels in a group', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId: defaultChannelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		const { channelId: secondChannelId, name } = await createTestChannel(baseUrl, apiKey, groupId)
		await openGroupChannel(page, baseUrl, groupId, defaultChannelId)
		const secondItem = page.locator(`.hub-channel-item[data-channel-id="${secondChannelId}"]`)
		await expect(secondItem).toBeVisible({ timeout: 60_000 })
		await secondItem.click()
		await expect(page).toHaveURL(new RegExp(`:${secondChannelId}`))
		await expect(page.locator('#hub-channel-name-display')).toContainText(name, { timeout: 30_000 })
		await expect(page.locator('#hub-message-input')).toBeEnabled({ timeout: 30_000 })
	})

	test('group settings page loads from hash', async ({ page, baseUrl, apiKey }) => {
		const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await openGroupSettingsPage(page, baseUrl, groupId)
		await expect(page.locator('#save-group-settings')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('.tabs .tab[data-tab="general"]')).toHaveClass(/tab-active/)
	})

	test('opens join group modal from server picker', async ({ page, baseUrl }) => {
		await waitForHubShell(page, baseUrl)
		await page.locator('#hub-add-server-button').click()
		await page.locator('.server-action-picker-card[data-action="join"]').click()
		await expect(page.locator('#join-group-form')).toBeVisible({ timeout: 30_000 })
		await page.locator('#join-group-form [data-action="cancel"]').click()
		await expect(page.locator('#join-group-form')).toBeHidden({ timeout: 10_000 })
	})

	test('opens federation settings overlay from server bar', async ({ page, baseUrl, apiKey }) => {
		await openFreshGroupChannel(page, baseUrl, apiKey)
		await page.locator('#hub-federation-settings-button').click()
		await expect(page.locator('#hub-overlay-body #federation-relay-urls')).toBeVisible({ timeout: 30_000 })
		await page.locator('#federation-close').click()
	})

	test('group header menu opens and manage navigates to settings', async ({ page, baseUrl, apiKey }) => {
		const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await page.locator('#hub-group-header').click()
		await expect(page.locator('.hub-group-menu-manage')).toBeVisible({ timeout: 10_000 })
		await page.locator('.hub-group-menu-manage').click()
		await expect(page).toHaveURL(
			new RegExp(`/parts/shells:chat/settings/#settings:${encodeURIComponent(groupId)}`),
			{ timeout: 30_000 },
		)
		await expect(page.locator('#group-settings-container')).toBeVisible({ timeout: 60_000 })
	})

	test('files drawer opens from header button', async ({ page, groupChannel: _ }) => {
		await expect(page.locator('#hub-header-files-button')).toBeVisible({ timeout: 30_000 })
		await page.locator('#hub-header-files-button').click()
		await expect(page.locator('#hub-files-title')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#hub-files-list')).toBeVisible()
	})

	test('discovery panel opens from federation settings', async ({ page, baseUrl, apiKey }) => {
		await openFreshGroupChannel(page, baseUrl, apiKey)
		await page.locator('#hub-federation-settings-button').click()
		await expect(page.locator('#federation-open-discovery')).toBeVisible({ timeout: 30_000 })
		await page.locator('#federation-open-discovery').click()
		await expect(page.locator('dialog [data-discovery-list]')).toBeVisible({ timeout: 30_000 })
		await page.locator('dialog [data-discovery-close]').click()
		await expect(page.locator('dialog [data-discovery-list]')).toHaveCount(0, { timeout: 10_000 })
	})
})
