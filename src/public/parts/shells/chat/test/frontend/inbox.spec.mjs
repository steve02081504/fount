import { ms } from 'fount/scripts/ms.mjs'
import { waitForHubShellReady } from 'fount/scripts/test/playwright/ready.mjs'

import {
	test,
	expect,
	seedMentionInbox,
} from './fixtures.mjs'

test.describe('Inbox', () => {
	test.setTimeout(600_000)

	test('seeded @mention shows badge, inbox list, and jump to message', async ({ page, baseUrl, apiKey, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const marker = `inbox-e2e ${Date.now()}`
		const { eventId } = await seedMentionInbox(baseUrl, apiKey, {
			groupId,
			channelId,
			text: marker,
		})

		await page.reload({ waitUntil: 'domcontentloaded' })
		await waitForHubShellReady(page)

		const badge = page.locator('#hub-inbox-badge')
		await expect(badge).toBeVisible({ timeout: ms('1m') })
		await expect(badge).toHaveText('1')

		await page.locator('.hub-server-inbox').click()
		await expect(page).toHaveURL(/#inbox/)
		await expect(page.locator('.hub-inbox-hero')).toHaveCount(0)
		await expect(page.locator('.hub-inbox-heading')).toHaveCount(0)
		await expect(page.locator('.hub-inbox-panel')).toBeVisible({ timeout: ms('1m') })
		await expect(page.locator('.hub-inbox-tabs')).toBeVisible()
		await expect(page.locator('#channel-bar')).toBeHidden()
		await expect(page.locator('.hub-main-header')).toBeHidden()
		const mentionTab = page.locator('#hub-inbox-tab-mention')
		const messageTab = page.locator('#hub-inbox-tab-message')
		await expect(mentionTab).toHaveAttribute('aria-selected', 'true')
		await mentionTab.focus()
		await page.keyboard.press('ArrowRight')
		await expect(messageTab).toHaveAttribute('aria-selected', 'true')
		await page.keyboard.press('ArrowLeft')
		await expect(mentionTab).toHaveAttribute('aria-selected', 'true')
		await expect(page.locator('#hub-inbox-list .hub-inbox-row').first())
			.toBeVisible({ timeout: ms('1m') })

		await page.locator('#hub-inbox-list .hub-inbox-row').first().click()
		await expect(page).toHaveURL(new RegExp(`#group:${encodeURIComponent(groupId)}`), { timeout: ms('2m') })
		await expect(page.locator('#hub-message-input')).toBeEnabled({ timeout: ms('2m') })
		const messageRow = page.locator(`#hub-messages .hub-message[data-message-id="${eventId}"]`)
		await expect(messageRow).toBeVisible({ timeout: ms('2m') })
		const expandButton = messageRow.getByRole('button', { name: '展开全文' })
		if (await expandButton.isVisible())
			await expandButton.click()
		await expect(messageRow).toContainText(marker)
		await expect(badge).toBeHidden({ timeout: ms('1m') })
	})
})
