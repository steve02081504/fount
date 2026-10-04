/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { preloadMentionedUrls } from '../../preload.mjs'
import { decodeQrCodeFromBuffer } from '../../qrcode.mjs'

/**
 * 把真实编码的二维码并排渲染为一张图片，可选择反色。
 * @param {string[]} contents Contents to encode.
 * @param {boolean} [inverted] Use light modules on a dark background.
 * @returns {Promise<Buffer>} PNG bytes.
 */
async function qrImage(contents, inverted = false) {
	const { Byte, Charset, Encoder } = await import('npm:@nuintun/qrcode')
	const { createCanvas, loadImage } = await import('npm:@napi-rs/canvas')
	const images = await Promise.all(contents.map(async text => {
		const url = new Encoder().encode(new Byte(text, Charset.UTF_8)).toDataURL(6, inverted ? { foreground: [255, 255, 255], background: [0, 0, 0] } : {})
		return await loadImage(Buffer.from(url.split(',')[1], 'base64'))
	}))
	const canvas = createCanvas(images.reduce((sum, image) => sum + image.width, 0), Math.max(...images.map(image => image.height)))
	const context = canvas.getContext('2d')
	context.fillStyle = inverted ? 'black' : 'white'
	context.fillRect(0, 0, canvas.width, canvas.height)
	let x = 0
	for (const image of images) { context.drawImage(image, x, 0); x += image.width }
	return canvas.toBuffer('image/png')
}

Deno.test('QR preload decodes multiple real codes and preloads their URL metadata in the first round', async () => {
	const url = 'https://example.com/qr'
	const image = await qrImage([url, '普通二维码文字'])
	assertEquals((await decodeQrCodeFromBuffer(image)).toSorted(), [url, '普通二维码文字'].toSorted())
	const logs = [{ role: 'user', content: '', files: [{ name: 'codes.png', mime_type: 'image/png', buffer: image }] }]
	const fetched = []
	const options = {
		/**
		 * @param {string} address Requested address.
		 * @returns {Promise<string>} Metadata.
		 */
		fetchMetadata: async address => { fetched.push(address); return 'title: QR page' },
	}
	const args = { char_id: 'test', chat_log: logs,
		/**
		 * @param {object} entry New entry.
		 * @returns {number} Log count.
		 */
		AddLongTimeLog: entry => logs.push(entry) }
	await preloadMentionedUrls(args, options)
	assertEquals(fetched, [url])
	assertStringIncludes(logs[1].content, '普通二维码文字')
	assertStringIncludes(logs[2].content, 'title: QR page')
	assertStringIncludes(logs[1].content_for_show, '```')
	logs.push({ role: 'user', content: url, files: [{ name: 'renamed.png', mime_type: 'image/png', buffer: image }] })
	await preloadMentionedUrls({ ...args, extension: {} }, { ...options,
		/**
		 * @returns {Promise<string[]>} Must not decode the same image again.
		 */
		decodeQr: async () => { throw new Error('duplicate decode') } })
	assertEquals(fetched, [url])
	assertEquals(logs.filter(entry => entry.name === 'web-browse.qrcode').length, 1)
})

Deno.test('QR decoder recognizes inverted codes', async () => {
	assertEquals(await decodeQrCodeFromBuffer(await qrImage(['https://example.com/inverted'], true)), ['https://example.com/inverted'])
})

Deno.test('QR preload saves empty and failed results without blocking other images or retrying', async () => {
	const logs = [{ role: 'user', content: '', files: [1, 2, 3].map(value => ({ name: `${value}.png`, mime_type: 'image/png', buffer: Buffer.from([value]) })) }]
	let decodes = 0
	const options = {
		/**
		 * @param {Buffer} buffer Image bytes.
		 * @returns {Promise<string[]>} Decoded results.
		 */
		decodeQr: async buffer => { decodes++; if (buffer[0] === 2) throw new Error('bad image'); return buffer[0] === 3 ? ['<unsafe> text'] : [] },
		/**
		 * @returns {Promise<string>} Unexpected request.
		 */
		fetchMetadata: async () => { throw new Error('plain text must not trigger fetch') },
	}
	const args = { chat_log: logs,
		/**
		 * @param {object} entry New entry.
		 * @returns {number} Log count.
		 */
		AddLongTimeLog: entry => logs.push(entry) }
	await preloadMentionedUrls(args, options)
	assertEquals(decodes, 3)
	assertStringIncludes(logs[1].content_for_show, '```')
	assertStringIncludes(logs[2].content, 'bad image')
	assertStringIncludes(logs[3].content, '未识别到二维码')
	await preloadMentionedUrls({ ...args, extension: {} }, options)
	assertEquals(decodes, 3)
})

Deno.test('QR links beyond the metadata limit continue in a later generation', async () => {
	const logs = [{ role: 'user', content: '', files: [{ name: 'links.png', mime_type: 'image/png', buffer: Buffer.from([4]) }] }]
	const fetched = []
	const options = {
		/**
		 * @returns {Promise<string[]>} Six distinct links.
		 */
		decodeQr: async () => Array.from({ length: 6 }, (_, index) => `https://example.com/${index}`),
		/**
		 * @param {string} url Address.
		 * @returns {Promise<string>} Metadata.
		 */
		fetchMetadata: async url => { fetched.push(url); return 'title: page' },
	}
	const args = { chat_log: logs,
		/**
		 * @param {object} entry New entry.
		 * @returns {number} Log count.
		 */
		AddLongTimeLog: entry => logs.push(entry) }
	await preloadMentionedUrls(args, options)
	assertEquals(fetched.length, 5)
	await preloadMentionedUrls({ ...args, extension: {} }, options)
	assertEquals(fetched.length, 6)
})
