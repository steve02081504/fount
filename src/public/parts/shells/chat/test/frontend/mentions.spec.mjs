import { ms } from 'fount/scripts/ms.mjs'
import { waitForHubShellReady } from 'fount/scripts/test/playwright/ready.mjs'

import {
	test,
	expect,
	seedMentionInbox,
	expectMessageInChat,
} from './fixtures.mjs'

test.describe('Mention inbox', () => {
	test.setTimeout(600_000)

	test('seeded @mention shows badge, inbox list, and jump to message', async ({ page, baseUrl, apiKey, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const marker = `mentions-e2e ${Date.now()}`
		await seedMentionInbox(baseUrl, apiKey, {
			groupId,
			channelId,
			text: marker,
		})

		await page.reload({ waitUntil: 'domcontentloaded' })
		await waitForHubShellReady(page)

		const badge = page.locator('#hub-mentions-badge')
		await expect(badge).toBeVisible({ timeout: ms('1m') })
		await expect(badge).toHaveText('1')

		await page.locator('.hub-server-mentions').click()
		await expect(page).toHaveURL(/#mentions/)
		await expect(page.locator('#hub-mentions-list .hub-mention-row').first())
			.toBeVisible({ timeout: ms('1m') })

		await page.locator('#hub-mentions-list .hub-mention-row').first().click()
		await expect(page.locator('#hub-message-input')).toBeEnabled({ timeout: ms('2m') })
		await expect(page).toHaveURL(new RegExp(`#group:${encodeURIComponent(groupId)}`))
		await expectMessageInChat(page, marker)
		await expect(badge).toBeHidden({ timeout: ms('1m') })
	})
})
