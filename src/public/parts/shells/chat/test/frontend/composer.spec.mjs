import { Buffer } from 'node:buffer'

import {
	test,
	expect,
	sendMessageViaComposer,
	expectMessageInChat,
	messageTextFromPostResponse,
	isChannelMessagePost,
} from './fixtures.mjs'

/** 1×1 PNG */
const TINY_PNG_BUFFER = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
)

test.describe('Chat composer', () => {
	test('publishes a message via composer', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `composer e2e ${Date.now()}`
		const postJson = await sendMessageViaComposer(page, groupId, channelId, text)
		expect(postJson.event?.type).toBe('message')
		expect(messageTextFromPostResponse(postJson)).toBe(text)
	})

	test('does not submit empty composer', async ({ page, groupChannel: _ }) => {
		await page.locator('#message-input').fill('')
		const postPromise = page.waitForResponse(
			res => res.request().method() === 'POST'
				&& res.url().includes('/channels/')
				&& res.url().includes('/messages'),
			{ timeout: 2_000 },
		).catch(() => null)
		await page.locator('#send-button').click()
		expect(await postPromise).toBeNull()
		await expect(page.locator('#message-input')).toHaveValue('')
	})

	test('published message appears in channel', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `feed-visible ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		await expectMessageInChat(page, text)
	})

	test('sends with Ctrl+Enter shortcut', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `ctrl-enter ${Date.now()}`
		const postPromise = page.waitForResponse(
			res => isChannelMessagePost(res, groupId, channelId),
			{ timeout: 20_000 },
		)
		await page.locator('#message-input').fill(text)
		await page.locator('#message-input').press('Control+Enter')
		const postJson = await (await postPromise).json()
		expect(postJson.event?.type).toBe('message')
		await expectMessageInChat(page, text)
	})

	test('pending image attachment stays compact in composer', async ({ page, groupChannel: _ }) => {
		await page.locator('#image-upload-input').setInputFiles({
			name: 'tiny.png',
			mimeType: 'image/png',
			buffer: TINY_PNG_BUFFER,
		})

		const preview = page.locator('#attachment-preview')
		await expect(preview).toBeVisible()
		const attachment = preview.locator('.attachment').first()
		await expect(attachment).toBeVisible()
		const img = attachment.locator('.preview-img')
		await expect(img).toBeVisible()
		const box = await img.boundingBox()
		expect(box).toBeTruthy()
		expect(box.width).toBeLessThanOrEqual(72)
		expect(box.height).toBeLessThanOrEqual(72)

		const attachBox = await attachment.boundingBox()
		expect(attachBox).toBeTruthy()
		expect(attachBox.width).toBeLessThanOrEqual(180)

		await attachment.hover()
		await expect(attachment.locator('.delete-button')).toBeVisible()
		await attachment.locator('.delete-button').click()
		await expect(preview.locator('.attachment')).toHaveCount(0)
	})

	test('emoji picker opens from composer', async ({ page, groupChannel: _ }) => {
		await page.locator('#emoji-button').click()
		await expect(page.locator('#emoji-picker')).toHaveClass(/show/)
		const picker = page.locator('#emoji-picker')
		await expect(picker.locator('.emoji-rail, [role="toolbar"]').first()).toBeVisible({ timeout: 30_000 })
		await expect(picker.locator('.emoji-rail-jump-start')).toBeHidden()
		await expect(picker.locator('.emoji-rail-jump-unicode')).toBeVisible()
		await picker.locator('.emoji-rail-item').first().click()
		await expect(picker.locator('.emoji-section').first()).toBeVisible()
		const gridButton = picker.locator('.emoji-grid-button').first()
		await expect(gridButton).toBeVisible({ timeout: 30_000 })
		const title = await gridButton.getAttribute('title')
		expect(title).toBeTruthy()
		expect(String(title).trim().length).toBeGreaterThan(0)
		const unicodeJump = picker.locator('.emoji-rail-jump-unicode')
		await unicodeJump.click()
		await expect(unicodeJump).toBeHidden({ timeout: 5_000 })
		await expect(picker.locator('.emoji-rail-jump-start')).toBeVisible()
		await picker.locator('.emoji-rail-jump-start').click()
		await expect(picker.locator('.emoji-rail-jump-start')).toBeHidden({ timeout: 5_000 })
		await expect(unicodeJump).toBeVisible()
	})

	test('vote modal opens and cancels', async ({ page, groupChannel: _ }) => {
		await page.locator('#vote-button').click()
		await expect(page.locator('#vote-modal')).toBeVisible({ timeout: 10_000 })
		await page.locator('#vote-cancel-button').click()
		await expect(page.locator('#vote-modal')).toBeHidden({ timeout: 10_000 })
	})
})
