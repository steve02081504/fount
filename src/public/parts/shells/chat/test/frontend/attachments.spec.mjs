import { Buffer } from 'node:buffer'
import { deflateSync } from 'node:zlib'

import {
	test,
	expect,
	isChannelMessagePost,
	expectMessageInChat,
	sendMessageViaComposer,
} from './fixtures.mjs'

/** 1×1 PNG 测试数据 */
const TINY_PNG_BUFFER = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
)

const PNG_CRC_TABLE = new Int32Array(256).map((_, n) => {
	let c = n
	for (let k = 0; k < 8; k++)
		c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
	return c
})

/**
 * @param {Buffer} buf 数据
 * @returns {number} PNG chunk 校验值
 */
function pngCrc32(buf) {
	let c = -1
	for (const byte of buf)
		c = PNG_CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
	return (c ^ -1) >>> 0
}

/**
 * @param {string} type 四字符 chunk 类型
 * @param {Buffer} data chunk 数据
 * @returns {Buffer} 完整 PNG chunk
 */
function pngChunk(type, data) {
	const out = Buffer.alloc(12 + data.length)
	out.writeUInt32BE(data.length, 0)
	out.write(type, 4, 'ascii')
	data.copy(out, 8)
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(pngCrc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0)
	crc.copy(out, 8 + data.length)
	return out
}

/**
 * 生成指定宽度的 8-bit 灰度 PNG（宽×1），用于复现宽图撑满 fit-content 气泡。
 * @param {number} width 像素宽度
 * @returns {Buffer} PNG 文件数据
 */
function widePng(width) {
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(width, 0)
	ihdr.writeUInt32BE(1, 4)
	ihdr[8] = 8
	ihdr[9] = 0
	const raw = Buffer.alloc(width + 1)
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk('IHDR', ihdr),
		pngChunk('IDAT', deflateSync(raw)),
		pngChunk('IEND', Buffer.alloc(0)),
	])
}

/** 2000px 宽大图：固有宽度远超气泡限宽（420px），用于验证气泡不被撑满整列 */
const WIDE_PNG_BUFFER = widePng(2000)

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

/**
 * 以真实剪贴板粘贴一张 PNG：同时写入 `text/html` 表示（模拟从网页复制图片）。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @returns {Promise<void>}
 */
async function pasteTinyPng(page) {
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
	await page.evaluate(pngBase64 => {
		const bytes = Uint8Array.from(atob(pngBase64), char => char.charCodeAt(0))
		const pngBlob = new Blob([bytes], { type: 'image/png' })
		const htmlBlob = new Blob([
			`<img src="data:image/png;base64,${pngBase64}" />`,
		], { type: 'text/html' })
		return navigator.clipboard.write([new ClipboardItem({
			'image/png': pngBlob,
			'text/html': htmlBlob,
		})])
	}, TINY_PNG_BUFFER.toString('base64'))
	await page.locator('#message-input').focus()
	await page.keyboard.press('Control+V')
	await expect(page.locator('#attachment-preview .attachment')).toHaveCount(1, { timeout: 10_000 })
}

test.describe('Chat message attachments', () => {
	test('sent image renders as img without [image: marker text', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const caption = `attach-e2e ${Date.now()}`
		await attachTinyPng(page)
		const postPromise = page.waitForResponse(
			response => isChannelMessagePost(response, groupId, channelId),
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
			response => isChannelMessagePost(response, groupId, channelId),
			{ timeout: 30_000 },
		)
		await page.locator('#message-input').fill(caption)
		await page.locator('#send-button').click()
		await postPromise
		const row = await expectMessageInChat(page, caption)
		const image = row.locator('.message-files img').first()
		await expect(image).toBeVisible({ timeout: 30_000 })
		await image.click()
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
			response => isChannelMessagePost(response, groupId, channelId),
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

	test('pasted image keeps image/* mime type in posted wire', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const caption = `paste-mime ${Date.now()}`
		await pasteTinyPng(page)
		// 含 text/html 表示也只产生一个图片附件（不得把文本表示误收成 text/* 附件）
		await expect(page.locator('#attachment-preview .attachment')).toHaveCount(1)
		const postPromise = page.waitForResponse(
			response => isChannelMessagePost(response, groupId, channelId),
			{ timeout: 30_000 },
		)
		await page.locator('#message-input').fill(caption)
		await page.locator('#send-button').click()
		const postJson = await (await postPromise).json()
		const files = postJson.event?.content?.files || []
		expect(files.length).toBe(1)
		const mimeType = String(files[0].mime_type || '')
		expect(mimeType).toBe('image/png')
		expect(mimeType.startsWith('text/')).toBe(false)
		expect(String(files[0].name || '')).toMatch(/\.png$/)

		const row = await expectMessageInChat(page, caption)
		await expect(row.locator('.message-files img').first()).toBeVisible({ timeout: 30_000 })
	})

	test('text + wide image does not stretch bubble to full column width', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel

		await sendMessageViaComposer(page, groupId, channelId, 'ping!')
		const textRow = await expectMessageInChat(page, 'ping!')
		const textBubbleWidth = await textRow.locator('.chat-bubble')
			.evaluate(el => el.getBoundingClientRect().width)
		expect(textBubbleWidth).toBeLessThan(300)

		const caption = `width-e2e ${Date.now()}`
		await page.locator('#image-upload-input').setInputFiles({
			name: 'wide.png',
			mimeType: 'image/png',
			buffer: WIDE_PNG_BUFFER,
		})
		await expect(page.locator('#attachment-preview .attachment')).toHaveCount(1, { timeout: 10_000 })
		const postPromise = page.waitForResponse(
			response => isChannelMessagePost(response, groupId, channelId),
			{ timeout: 30_000 },
		)
		await page.locator('#message-input').fill(caption)
		await page.locator('#send-button').click()
		await postPromise
		const row = await expectMessageInChat(page, caption)
		const bubble = row.locator('.chat-bubble')
		await expect(bubble).toBeVisible({ timeout: 30_000 })
		await expect(row.locator('.message-files img').first()).toBeVisible({ timeout: 30_000 })

		const bubbleWidth = await bubble.evaluate(el => el.getBoundingClientRect().width)
		const columnWidth = await page.locator('#messages > .chat').first()
			.evaluate(el => el.getBoundingClientRect().width)
		// 宽图消息气泡应贴合内容（420px 图 + 内边距 ≈ 447px），不得被图片固有宽度撑到整列（~650px+）
		expect(bubbleWidth).toBeLessThan(500)
		expect(bubbleWidth).toBeLessThan(columnWidth * 0.75)
	})
})
