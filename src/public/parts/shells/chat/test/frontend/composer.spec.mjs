import { Buffer } from 'node:buffer'

import { ms } from 'fount/scripts/ms.mjs'
import { withApiRequest } from 'fount/scripts/test/playwright/api.mjs'

import {
	test,
	expect,
	sendMessageViaComposer,
	expectMessageInChat,
	messageTextFromPostResponse,
	isChannelMessagePost,
} from './fixtures.mjs'

/** ≥128×128 PNG，用于验证预览尺寸上限 */
const TINY_PNG_BUFFER = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAAxElEQVR42u3RMQ0AAAjAsPk3DTLgaDIFa1M6zAIAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABAADAAgAABACAAAAQAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAAAjAixYgaMOy89oM6gAAAABJRU5ErkJggg==',
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
			response => response.request().method() === 'POST'
				&& response.url().includes('/channels/')
				&& response.url().includes('/messages'),
			{ timeout: 2_000 },
		).catch(() => null)
		await page.locator('#send-button').click()
		expect(await postPromise).toBeNull()
		await expect(page.locator('#message-input')).toHaveJSProperty('value', '')
	})

	test('placeholder stays visible with whitespace-only draft', async ({ page, groupChannel, baseUrl, apiKey }) => {
		const { groupId, channelId } = groupChannel
		const input = page.locator('#message-input')
		const placeholder = input.locator('.fount-markdown-rich-input-placeholder')
		await expect(placeholder).toBeVisible()
		await expect(placeholder).toHaveText(/\S/)

		// 空 composer 中敲 Enter 会在草稿里留下一个 `\n`；该草稿不应吃掉输入框占位符。
		const key = `${groupId}:${channelId}`
		const res = await withApiRequest(req => req.put(
			`${baseUrl}/api/parts/shells:chat/drafts/${encodeURIComponent(key)}?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: { text: '\n', files: [] } },
		))
		expect(res.ok()).toBe(true)

		await page.reload({ waitUntil: 'domcontentloaded' })
		await expect(input).toBeEnabled({ timeout: ms('1m') })
		await expect(input).toHaveJSProperty('value', '')
		await expect(placeholder).toBeVisible()
		await expect(placeholder).toHaveText(/\S/)
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
			response => isChannelMessagePost(response, groupId, channelId),
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
		const image = attachment.locator('.preview-img')
		await expect(image).toBeVisible()
		const box = await image.boundingBox()
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
		// unicode 若靠近顶部，scrollTop 可能仍 < 8，回顶按钮按设计保持 hidden
		const scroll = picker.locator('.emoji-scroll')
		await scroll.evaluate(element => { element.scrollTop = Math.max(element.scrollTop, 40) })
		const jumpStart = picker.locator('.emoji-rail-jump-start')
		await expect(jumpStart).toBeVisible({ timeout: 5_000 })
		await jumpStart.click()
		await expect(jumpStart).toBeHidden({ timeout: 5_000 })
		await expect(unicodeJump).toBeVisible()
	})

	test('vote modal opens and cancels', async ({ page, groupChannel: _ }) => {
		await page.locator('#vote-button').click()
		await expect(page.locator('#vote-modal')).toBeVisible({ timeout: 10_000 })
		await page.locator('#vote-cancel-button').click()
		await expect(page.locator('#vote-modal')).toBeHidden({ timeout: 10_000 })
	})
})
