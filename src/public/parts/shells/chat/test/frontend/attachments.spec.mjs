import { Buffer } from 'node:buffer'

import {
	test,
	expect,
	isChannelMessagePost,
	expectMessageInChat,
} from './fixtures.mjs'

/** 1×1 PNG */
const TINY_PNG_BUFFER = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
)

/**
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @param {string} [name='tiny.png'] 附件文件名
 * @returns {Promise<void>}
 */
async function attachTinyPng(page, name = 'tiny.png') {
	await page.locator('#image-upload-input').setInputFiles({
		name,
		mimeType: 'image/png',
		buffer: TINY_PNG_BUFFER,
	})
	await expect(page.locator('#attachment-preview .attachment')).toHaveCount(1, { timeout: 10_000 })
}

test.describe('Chat message attachments', () => {
	test('sent image renders as img without [image: marker text', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const caption = `attach-e2e ${Date.now()}`
		await attachTinyPng(page)
		const postPromise = page.waitForResponse(
			res => isChannelMessagePost(res, groupId, channelId),
			{ timeout: 30_000 },
		)
		await page.locator('#message-input').fill(caption)
		await page.locator('#send-button').click()
		const postJson = await (await postPromise).json()
		const content = postJson.event?.content
		expect(String(content?.content ?? '')).not.toContain('[image:')
		expect(Array.isArray(content?.files) && content.files.length >= 1).toBe(true)
		expect(String(content.files[0].fileId || '')).toBeTruthy()

		const row = await expectMessageInChat(page, caption)
		await expect(row.locator('.message-files img').first()).toBeVisible({ timeout: 30_000 })
		await expect(row.locator('.message-content')).not.toContainText('[image:')
	})

	test('clicking sent image opens media viewer closable by Escape', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const caption = `viewer-e2e ${Date.now()}`
		await attachTinyPng(page, 'viewer.png')
		const postPromise = page.waitForResponse(
			res => isChannelMessagePost(res, groupId, channelId),
			{ timeout: 30_000 },
		)
		await page.locator('#message-input').fill(caption)
		await page.locator('#send-button').click()
		await postPromise
		const row = await expectMessageInChat(page, caption)
		const img = row.locator('.message-files img').first()
		await expect(img).toBeVisible({ timeout: 30_000 })
		await img.click()
		const viewer = page.locator('.media-viewer')
		await expect(viewer).toBeVisible({ timeout: 10_000 })
		await page.keyboard.press('Escape')
		await expect(viewer).toHaveCount(0, { timeout: 10_000 })
	})

	test('two images render in a gallery grid', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const caption = `gallery-e2e ${Date.now()}`
		await page.locator('#image-upload-input').setInputFiles([
			{ name: 'a.png', mimeType: 'image/png', buffer: TINY_PNG_BUFFER },
			{ name: 'b.png', mimeType: 'image/png', buffer: TINY_PNG_BUFFER },
		])
		await expect(page.locator('#attachment-preview .attachment')).toHaveCount(2, { timeout: 10_000 })
		const postPromise = page.waitForResponse(
			res => isChannelMessagePost(res, groupId, channelId),
			{ timeout: 30_000 },
		)
		await page.locator('#message-input').fill(caption)
		await page.locator('#send-button').click()
		await postPromise
		const row = await expectMessageInChat(page, caption)
		await expect(row.locator('.message-gallery')).toBeVisible({ timeout: 30_000 })
		await expect(row.locator('.message-gallery img')).toHaveCount(2, { timeout: 30_000 })
		await expect(row.locator('.message-content')).not.toContainText('[image:')
	})
})
