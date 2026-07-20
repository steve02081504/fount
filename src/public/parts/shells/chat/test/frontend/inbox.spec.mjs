import { ms } from 'fount/scripts/ms.mjs'
import { waitForHubReady } from 'fount/scripts/test/playwright/ready.mjs'

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
		await waitForHubReady(page)

		const badge = page.locator('#inbox-badge')
		await expect(badge).toBeVisible({ timeout: ms('1m') })
		await expect(badge).toHaveText('1')

		await page.locator('.server-inbox').click()
		await expect(page).toHaveURL(/#inbox/)
		await expect(page.locator('.inbox-hero')).toHaveCount(0)
		await expect(page.locator('.inbox-heading')).toHaveCount(0)
		await expect(page.locator('.inbox-panel')).toBeVisible({ timeout: ms('1m') })
		await expect(page.locator('.inbox-tabs')).toBeVisible()
		await expect(page.locator('#channel-bar')).toBeHidden()
		await expect(page.locator('.main-header')).toBeHidden()
		await expect(page.locator('.input-area')).toBeHidden()
		const mentionTab = page.locator('#inbox-tab-mention')
		const messageTab = page.locator('#inbox-tab-message')
		await expect(mentionTab).toHaveAttribute('aria-selected', 'true')
		await mentionTab.focus()
		await page.keyboard.press('ArrowRight')
		await expect(messageTab).toHaveAttribute('aria-selected', 'true')
		await page.keyboard.press('ArrowLeft')
		await expect(mentionTab).toHaveAttribute('aria-selected', 'true')
		await expect(page.locator('#inbox-list .inbox-row').first())
			.toBeVisible({ timeout: ms('1m') })

		await page.locator('#inbox-list .inbox-row').first().click()
		await expect(page).toHaveURL(new RegExp(`#group:${encodeURIComponent(groupId)}`), { timeout: ms('2m') })
		const messageInput = page.locator('#message-input')
		await expect(messageInput).toBeEnabled({ timeout: ms('2m') })
		await expect(messageInput).toHaveValue('')
		const messageRow = page.locator(`#messages .message[data-message-id="${eventId}"]`)
		await expect(messageRow).toBeVisible({ timeout: ms('2m') })
		await expect(messageRow).toContainText(marker)
		await expect(badge).toBeHidden({ timeout: ms('1m') })
	})
})
