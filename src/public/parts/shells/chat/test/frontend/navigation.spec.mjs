import {
	test,
	expect,
	waitForHub,
	openFreshGroupChannel,
	openGroupChannel,
	createGroupViaHubUi,
	createTestChannel,
	openGroupSettingsPage,
	createFriendChatGroup,
} from './fixtures.mjs'

test.describe('Chat hub navigation', () => {
	test('rapid inbox/group switching keeps surface consistent', async ({ page, baseUrl, apiKey }) => {
		const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		const groupItem = page.locator(`#server-list .server-item[data-group-id="${groupId}"]`)
		await expect(groupItem).toBeVisible({ timeout: 60_000 })
		// 快速在 inbox 与群之间来回点击，触发 selectGroup 异步竞态
		for (let i = 0; i < 3; i++) {
			await page.locator('.server-inbox').click()
			await groupItem.click()
		}
		await page.locator('.server-inbox').click()
		// 最终应稳定落在 inbox：surface 正确、频道栏隐藏、inbox 面板可见
		await expect(page).toHaveURL(/#inbox/)
		await expect(page.locator('.inbox-panel')).toBeVisible({ timeout: 60_000 })
		await expect(page.locator('body')).toHaveAttribute('data-surface', 'inbox')
		await expect(page.locator('#channel-bar')).toBeHidden()
		await expect(page.locator('.main-header')).toBeHidden()
	})

	test('switches between groups and friends mode', async ({ page, baseUrl, apiKey }) => {
		const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await page.locator('.server-item[data-mode="friends"]').click()
		await expect(page.locator('#message-input')).toBeDisabled({ timeout: 60_000 })
		await expect(page.locator('.input-area')).toBeHidden()
		await expect(page.locator('.empty--friends')).toBeVisible()
		await page.locator('#friends-empty-search-button').click()
		await expect(page.locator('#friends-search-input')).toBeFocused()
		await expect(page).toHaveURL(/#friends/)
		await page.setViewportSize({ width: 600, height: 700 })
		await expect(page.locator('#channel-bar')).toBeVisible()
		await page.setViewportSize({ width: 1280, height: 720 })
		await page.locator(`.server-item[data-group-id="${groupId}"]`).click()
		await expect(page.locator('#channel-list')).toBeVisible({ timeout: 30_000 })
	})

	test('leaving the only group switches to friends view instead of opening a DM as group', async ({
		page,
		baseUrl,
		apiKey,
	}) => {
		const { groupId: normalGroupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey, {
			name: `pw-leave-normal-${Date.now()}`,
		})
		const { groupId: dmGroupId } = await createFriendChatGroup(baseUrl, apiKey, 'on_message_yes', {
			name: `pw-leave-dm-${Date.now()}`,
		})

		await openGroupChannel(page, baseUrl, normalGroupId, channelId)
		await expect(page).toHaveURL(new RegExp(`#group:${encodeURIComponent(normalGroupId)}`), { timeout: 60_000 })
		// DM 群应显示在好友列表，而非群侧栏
		await expect(page.locator(`#server-list .server-item[data-group-id="${dmGroupId}"]`)).toHaveCount(0)

		page.once('dialog', dialog => dialog.accept())
		await page.locator(`#server-list .server-item[data-group-id="${normalGroupId}"]`).click({ button: 'right' })
		await page.locator('.group-menu-leave').click()

		// 退掉唯一普通群后应回到好友/DM 视图，而不是把 DM 群当群聊视图打开
		await expect(page).toHaveURL(/#friends/, { timeout: 60_000 })
		await expect(page.locator('body')).toHaveAttribute('data-surface', 'friends')
		await expect(page.locator('#channel-list')).toBeHidden()
		await expect(page.locator('.empty--friends')).toBeVisible()
		await expect(page.locator('#message-input')).toBeDisabled()
	})

	test('creates a group via hub UI', async ({ page, baseUrl }) => {
		const { groupId, channelId } = await createGroupViaHubUi(page, baseUrl, {
			name: `pw-nav-ui-${Date.now()}`,
		})
		expect(groupId).toBeTruthy()
		expect(channelId).toBeTruthy()
		await expect(page.locator('#channel-list .channel-item')).toHaveCount(1, { timeout: 30_000 })
	})

	test('switches between channels in a group', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId: defaultChannelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		const { channelId: secondChannelId, name } = await createTestChannel(baseUrl, apiKey, groupId)
		await openGroupChannel(page, baseUrl, groupId, defaultChannelId)
		const secondItem = page.locator(`.channel-item[data-channel-id="${secondChannelId}"]`)
		await expect(secondItem).toBeVisible({ timeout: 60_000 })
		await secondItem.click()
		await expect(page).toHaveURL(new RegExp(`:${secondChannelId}`))
		await expect(page.locator('#channel-name-display')).toContainText(name, { timeout: 30_000 })
		await expect(page.locator('#message-input')).toBeEnabled({ timeout: 30_000 })
	})

	test('group settings page loads from hash', async ({ page, baseUrl, apiKey }) => {
		const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await openGroupSettingsPage(page, baseUrl, groupId)
		await expect(page.locator('#save-group-settings')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('.settings-nav-item[data-section="general"]')).toHaveClass(/tab-active/)
		await expect(page.locator('.settings-nav-item[data-section="general"]')).toHaveAttribute('aria-selected', 'true')
		await expect(page.locator('#group-name')).toBeVisible()
		await expect(page.locator('.settings-advanced').first()).not.toHaveAttribute('open', '')
		await expect(page.locator('#max-dag-payload-bytes')).toBeHidden()
	})

	test('group creation and join dialogs return to the server picker', async ({ page, baseUrl }) => {
		await waitForHub(page, baseUrl)
		await page.locator('#add-server-button').click()
		const picker = page.locator('.server-action-picker-box')
		await picker.locator('[data-action="join"]').click()
		await expect(page.locator('#join-group-form')).toBeVisible({ timeout: 30_000 })
		await page.locator('#join-group-form [data-dialog-back]').click()
		await expect(picker).toBeVisible()
		await expect(page.locator('#join-group-form')).toHaveCount(0)

		await picker.locator('[data-action="create"]').click()
		await expect(page.locator('#create-group-form')).toBeVisible()
		await page.locator('#create-group-form [data-dialog-back]').click()
		await expect(picker).toBeVisible()
		await picker.locator('[data-cancel]').click()
		await expect(picker).toHaveCount(0)
	})

	test('opens hub prefs with translation and federation sections', async ({ page, baseUrl, apiKey }) => {
		await openFreshGroupChannel(page, baseUrl, apiKey)

		const prefsButton = page.locator('#prefs-button')
		await expect(prefsButton.locator('svg[src*="cog.svg"], img[src*="cog.svg"]')).toBeVisible()
		await prefsButton.click()

		const prefsShell = page.locator('#settings-modal .prefs-shell')
		await expect(prefsShell).toBeVisible({ timeout: 15_000 })
		await expect(page.locator('#settings-modal [data-prefs-section="translation"]')).toHaveClass(/tab-active/)
		await expect(page.locator('#settings-modal #auto-translate')).toBeVisible()

		await page.locator('#settings-modal [data-prefs-section="federation"]').click()
		await expect(page.locator('#settings-modal [data-prefs-section="federation"]')).toHaveClass(/tab-active/)
		await expect(page.locator('#overlay-body #federation-relay-urls')).toBeVisible({ timeout: 30_000 })
		const relayTip = page.locator('.info-tip').first()
		await expect(relayTip).toHaveClass(/tooltip/)
		await expect(relayTip).not.toHaveAttribute('data-tip', '')
		await relayTip.hover()
		await expect.poll(() => relayTip.evaluate(element => getComputedStyle(element, '::before').content))
			.not.toBe('none')
		await expect(page.locator('#federation-open-discovery')).toHaveCount(0)
		await expect(page.locator('.advanced-settings')).not.toHaveAttribute('open', '')
		await expect(page.locator('#federation-dm-rotate')).toBeHidden()
		await page.locator('.advanced-settings > summary').click()
		await expect(page.locator('#federation-dm-rotate')).toBeVisible()
		await page.locator('#federation-close').click()
		await expect(prefsShell).toHaveCount(0)
	})

	test('conversation header actions keep accessible icons', async ({ page, groupChannel: _ }) => {
		const callButton = page.locator('#header-call-button')
		await expect(callButton).toBeVisible({ timeout: 30_000 })
		await expect(callButton.locator('img, svg')).toBeVisible()
		await expect(callButton).not.toHaveAttribute('title', '')
		await expect(callButton).toHaveAttribute('aria-label', /.+/)
	})

	test('group header menu opens and manage navigates to settings', async ({ page, baseUrl, apiKey }) => {
		const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await page.locator('#group-header').click()
		await expect(page.locator('.group-menu-manage')).toBeVisible({ timeout: 10_000 })
		await page.locator('.group-menu-manage').click()
		await expect(page).toHaveURL(
			new RegExp(`/parts/shells:chat/settings/#settings:${encodeURIComponent(groupId)}`),
			{ timeout: 30_000 },
		)
		await expect(page.locator('#group-settings-container')).toBeVisible({ timeout: 60_000 })
	})

	test('files drawer opens from header button', async ({ page, groupChannel: _ }) => {
		await expect(page.locator('#header-files-button')).toBeVisible({ timeout: 30_000 })
		await page.locator('#header-files-button').click()
		await expect(page.locator('#files-title')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#files-list')).toBeVisible()
	})

	test('discovery page opens from server bar compass', async ({ page, baseUrl, apiKey }) => {
		await openFreshGroupChannel(page, baseUrl, apiKey)
		const discoveryButton = page.locator('#discovery-button')
		await expect(discoveryButton.locator('svg[src*="compass-outline.svg"]')).toBeVisible()
		await discoveryButton.click()
		await expect(page).toHaveURL(/#discovery/)
		await expect(page.locator('.discovery-page')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('[data-discovery-grid]')).toBeVisible()
		await expect(page.locator('#discovery-button')).toHaveClass(/mode-active/)
	})
})
