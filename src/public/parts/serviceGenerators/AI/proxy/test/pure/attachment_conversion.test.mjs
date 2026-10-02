/**
 * 附件 MIME 转换（允许列表、别名、图像重编码、文本转换、系统提示）与 Responses 图片映射的纯逻辑。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'
import sharp from 'npm:sharp'

import { messagesToResponsesBody } from '../../../codex/src/responsesClient.mjs'
import { buildFileContentParts } from '../../src/fileContentParts.mjs'

Deno.test('historical AVIF sticker becomes a PNG user image in Responses and snapshots', async () => {
	const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff000080' } }).avif().toBuffer()
	const file = { name: 'sticker.avif', mime_type: 'image/avif', buffer: bytes }
	const allowedMimeTypes = ['image/png', 'image/jpeg']
	const original = await buildFileContentParts([file], 'sticker')
	assertEquals(original.parts[1].image_url.url, `data:image/avif;base64,${bytes.toString('base64')}`)
	const { parts, skipped } = await buildFileContentParts([file], 'sticker', { allowedMimeTypes })
	assertEquals(skipped, [])
	assertStringIncludes(parts[1].image_url.url, 'data:image/png;base64,')
	const body = messagesToResponsesBody([{ role: 'assistant', content: parts }], { model: 'mock' })
	assertEquals(body.input[1].role, 'user')
	assertEquals(body.input[1].content[0].type, 'input_image')
	assertEquals(body.input[1].content[0].image_url, parts[1].image_url.url)
	const snapshot = await buildFileContentParts([file], 'sticker', { binaryMode: 'buffer', allowedMimeTypes })
	assertEquals(snapshot.parts[1].image_url.mime_type, 'image/png')
	assertEquals(snapshot.parts[1].image_url.data.toString('base64'), parts[1].image_url.url.split(',')[1])
	const metadata = await sharp(snapshot.parts[1].image_url.data).metadata()
	assertEquals(metadata.width, 2)
	assertEquals(metadata.height, 2)
	assertEquals(metadata.hasAlpha, true)
	assertEquals(file.mime_type, 'image/avif')
	assertEquals(file.buffer, bytes)
})

Deno.test('default and explicitly allowed images preserve declared MIME and bytes', async () => {
	const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } }).png().toBuffer()
	for (const allowedMimeTypes of [undefined, null, ['image/jpeg']]) {
		const { parts } = await buildFileContentParts([{ name: 'wrong.jpg', mime_type: 'image/jpeg', buffer: bytes }], '', { allowedMimeTypes })
		assertEquals(parts[1].image_url.url, `data:image/jpeg;base64,${bytes.toString('base64')}`)
	}
})

Deno.test('undecodable AVIF sticker is skipped instead of poisoning the request', async () => {
	const { parts, notices } = await buildFileContentParts([
		{ name: 'broken.avif', mime_type: 'image/avif', buffer: Buffer.from('not an image') },
	], 'still readable', { allowedMimeTypes: ['image/png'] })
	assertEquals(parts, [{ type: 'text', text: 'still readable' }])
	assertEquals(notices.length, 1)
	assertStringIncludes(notices[0], 'broken.avif')
	assertStringIncludes(notices[0], 'System Notice')
})

Deno.test('conversion selects an encoder from the allowed list instead of assuming PNG', async () => {
	const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff000080' } }).avif().toBuffer()
	const { parts } = await buildFileContentParts([{ name: 'a.avif', mime_type: 'image/avif', buffer: bytes }], '', { allowedMimeTypes: ['audio/wav', 'image/webp', 'image/png'], binaryMode: 'buffer' })
	assertEquals(parts[1].image_url.mime_type, 'image/webp')
	assertEquals((await sharp(parts[1].image_url.data).metadata()).format, 'webp')
})

Deno.test('empty list and incompatible targets replace attachments with system hints', async () => {
	for (const allowedMimeTypes of [[], ['audio/wav'], ['image/unknown']]) {
		const { parts, notices } = await buildFileContentParts([{ name: 'a.avif', mime_type: 'image/avif', buffer: Buffer.from('bytes') }], 'hello', { allowedMimeTypes })
		assertEquals(parts.length, 1)
		assertEquals(notices.length, 1)
		assertStringIncludes(notices[0], 'image/avif')
	}
})

Deno.test('text conversion and audio MIME aliases preserve content', async () => {
	const { parts, notices } = await buildFileContentParts([
		{ name: 'data.json', mime_type: 'application/json', buffer: Buffer.from('{"a":1}') },
		{ name: 'audio.mp3', mime_type: 'audio/mpeg', buffer: Buffer.from('audio') },
	], '', { allowedMimeTypes: ['text/plain', 'audio/mp3'] })
	assertEquals(notices, [])
	assertEquals(parts[1], { type: 'text', text: '{"a":1}' })
	assertEquals(parts[2].input_audio.format, 'mp3')
})

Deno.test('unsupported video, absent MIME and invalid text produce hints', async () => {
	const { parts, notices } = await buildFileContentParts([
		{ name: 'video.webm', mime_type: 'video/webm', buffer: Buffer.from('video') },
		{ name: 'unknown', buffer: Buffer.from('bytes') },
		{ name: 'bad.txt', mime_type: 'text/plain', buffer: Buffer.from([0xff]) },
	], '', { allowedMimeTypes: ['video/mp4', 'text/plain'] })
	assertEquals(parts.length, 1)
	assertEquals(notices.length, 3)
})
