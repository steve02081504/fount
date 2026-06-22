import {
	test,
	expect,
	openChatHub,
	openFreshGroupChannel,
	sendMessageViaComposer,
} from './fixtures.mjs'

test.describe('Chat hub navigation', () => {
	test('friends mode disables composer', async ({ page, baseUrl }) => {
		await openChatHub(page, baseUrl)
		await expect(page.locator('#hub-message-input')).toBeDisabled()
		await page.locator('.hub-server-item[data-mode="friends"]').click()
		await expect(page.locator('#hub-message-input')).toBeDisabled()
	})

	test('group appears in server bar after creation', async ({ page, baseUrl, apiKey }) => {
		const groupName = `nav-bar-${Date.now()}`
		const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey, { name: groupName })
		await expect(page.locator(`#hub-server-list .hub-server-item[data-group-id="${groupId}"]`)).toBeVisible()
	})

	test('members panel toggles open class', async ({ page, baseUrl, apiKey }) => {
		await openFreshGroupChannel(page, baseUrl, apiKey)
		const memberBar = page.locator('#hub-member-bar')
		await expect(memberBar).not.toHaveClass(/hub-member-bar--open/)
		await page.locator('#hub-toggle-members-button').click()
		await expect(memberBar).toHaveClass(/hub-member-bar--open/)
		await page.locator('#hub-toggle-members-button').click()
		await expect(memberBar).not.toHaveClass(/hub-member-bar--open/)
	})

	test('header search input accepts query', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		const text = `search-target ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		const search = page.locator('#hub-header-search')
		await search.fill(text.slice(0, 8))
		await expect(search).toHaveValue(text.slice(0, 8))
	})

	test('settings button opens modal', async ({ page, baseUrl, apiKey }) => {
		await openFreshGroupChannel(page, baseUrl, apiKey)
		await page.locator('#hub-header-settings-button').click()
		await expect(page.locator('#hub-settings-modal')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('#hub-overlay-title')).toBeVisible()
	})
})
