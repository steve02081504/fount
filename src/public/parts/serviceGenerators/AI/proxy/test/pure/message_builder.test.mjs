/**
 * fileContentParts：附件字节不可用（空 buffer / 解密失败）时不得产出空 base64 data URL，
 * 须跳过；MIME 参数（`;charset=`）须剥离。messageBuilder 的空 buffer 防御即来自此模块。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals, assertStringIncludes, assertFalse } from 'jsr:@std/assert'

import {
	buildFileContentParts,
	mimeTypeBase,
	resolveFileBuffer,
} from '../../src/fileContentParts.mjs'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

Deno.test('mimeTypeBase strips parameters', () => {
	assertEquals(mimeTypeBase('image/png;charset=utf-8'), 'image/png')
	assertEquals(mimeTypeBase('audio/wav'), 'audio/wav')
})

Deno.test('resolveFileBuffer prefers async getBuffer and rejects empty', async () => {
	assertEquals((await resolveFileBuffer({ getBuffer: async () => PNG })).equals(PNG), true)
	assertEquals(await resolveFileBuffer({ getBuffer: async () => Buffer.alloc(0) }), null)
	assertEquals(await resolveFileBuffer({ getBuffer: async () => { throw new Error('fetch fail') } }), null)
	assertEquals((await resolveFileBuffer({ buffer: PNG })).equals(PNG), true)
	assertEquals(await resolveFileBuffer({ buffer: Buffer.alloc(0) }), null)
	assertEquals(await resolveFileBuffer({}), null)
})

Deno.test('image file with bytes becomes data URL (mime params stripped)', async () => {
	const { parts, skipped } = await buildFileContentParts([
		{ name: 'a.png', mime_type: 'image/png;charset=utf-8', getBuffer: async () => PNG },
	], '看图')
	assertEquals(skipped, [])
	const imagePart = parts.find(p => p.type === 'image_url')
	assert(imagePart, 'expected an image_url part')
	assertStringIncludes(imagePart.image_url.url, `data:image/png;base64,${PNG.toString('base64')}`)
	assertFalse(imagePart.image_url.url.includes('charset'))
})

Deno.test('empty or failing buffer skips file, never emits empty data URL', async () => {
	const { parts, skipped } = await buildFileContentParts([
		{ name: 'remote.png', mime_type: 'image/png', getBuffer: async () => { throw new Error('ciphertext missing') } },
		{ name: 'empty.png', mime_type: 'image/png', getBuffer: async () => Buffer.alloc(0) },
	], '看图')
	assertEquals(skipped, ['remote.png', 'empty.png'])
	assertEquals(parts.filter(p => p.type === 'image_url').length, 0)
})

Deno.test('audio file maps to input_audio with format', async () => {
	const { parts, skipped } = await buildFileContentParts([
		{ name: 'a.wav', mime_type: 'audio/wav', buffer: PNG },
	], '听')
	assertEquals(skipped, [])
	const part = parts.find(p => p.type === 'input_audio')
	assert(part, 'expected an input_audio part')
	assertEquals(part.input_audio.format, 'wav')
	assertStringIncludes(part.input_audio.data, PNG.toString('base64'))
})
