/**
 * fileContentParts（附件字节不可用 / MIME 参数剥离）与 messagePolicies（convert_config 的
 * ignoreFiles / forbidSystemFiles MIME 正则策略、system → user 降级、正文加前缀）的纯逻辑。
 * 此文件不得静态 import messageBuilder（会拉入 src/decl 图，pure 套件类型检查会失败）。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals, assertStringIncludes, assertFalse } from 'jsr:@std/assert'

import {
	buildFileContentParts,
	fileMimeType,
	matchesMimePatterns,
	mimeTypeBase,
	resolveFileBuffer,
} from '../../src/fileContentParts.mjs'
import {
	normalizeMimePatterns,
	prependText,
	splitDeniedFiles,
	systemMessageCarriesDeniedFiles,
} from '../../src/messagePolicies.mjs'

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

Deno.test('matchesMimePatterns matches regex, falls back for missing mime, ignores bad patterns', () => {
	assert(matchesMimePatterns(['^image/'], { mime_type: 'image/png' }))
	assertFalse(matchesMimePatterns(['^image/'], { mime_type: 'audio/wav' }))
	assert(matchesMimePatterns(['application/(octet-stream|pdf)'], {}))
	assertFalse(matchesMimePatterns(['['], { mime_type: 'image/png' }))
	assertFalse(matchesMimePatterns([], { mime_type: 'image/png' }))
	assertFalse(matchesMimePatterns(undefined, { mime_type: 'image/png' }))
	assertEquals(fileMimeType({}), 'application/octet-stream')
})

Deno.test('normalizeMimePatterns keeps lists and maps legacy true to match-all', () => {
	assertEquals(normalizeMimePatterns(['^image/']), ['^image/'])
	assertEquals(normalizeMimePatterns(true), ['.*'])
	assertEquals(normalizeMimePatterns(false), [])
	assertEquals(normalizeMimePatterns(undefined), [])
	assertEquals(normalizeMimePatterns('image/'), [])
})

Deno.test('splitDeniedFiles drops matching attachments and announces them', () => {
	const files = [
		{ name: 'a.png', mime_type: 'image/png' },
		{ name: 'b.pdf', mime_type: 'application/pdf' },
	]
	const { kept, notice } = splitDeniedFiles(files, ['^application/pdf$'])
	assertEquals(kept.map(file => file.name), ['a.png'])
	assertStringIncludes(notice, 'file \'b.pdf\'')
	assertStringIncludes(notice, 'type \'application/pdf\'')
})

Deno.test('splitDeniedFiles with no patterns keeps all files untouched', () => {
	const files = [{ name: 'a.png', mime_type: 'image/png' }]
	const { kept, notice } = splitDeniedFiles(files, [])
	assertEquals(kept, files)
	assertEquals(notice, '')
})

Deno.test('legacy ignoreFiles:true pattern drops every attachment', () => {
	const { kept } = splitDeniedFiles(
		[{ name: 'a.png', mime_type: 'image/png' }],
		normalizeMimePatterns(true),
	)
	assertEquals(kept, [])
})

Deno.test('systemMessageCarriesDeniedFiles only fires for system role hits', () => {
	const files = [{ name: 'pic.png', mime_type: 'image/png' }]
	assert(systemMessageCarriesDeniedFiles('system', files, ['^image/']))
	assertFalse(systemMessageCarriesDeniedFiles('user', files, ['^image/']))
	assertFalse(systemMessageCarriesDeniedFiles('assistant', files, ['^image/']))
	assertFalse(systemMessageCarriesDeniedFiles('system', files, ['^audio/']))
	assertFalse(systemMessageCarriesDeniedFiles('system', [{}], ['^image/']))
})

Deno.test('prependText prefixes string and only the first text part', () => {
	assertEquals(prependText('body', 'system: '), 'system: body')
	assertEquals(prependText([
		{ type: 'text', text: 'body' },
		{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
		{ type: 'text', text: '\n[System Notice: x]' },
	], 'system: '), [
		{ type: 'text', text: 'system: body' },
		{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
		{ type: 'text', text: '\n[System Notice: x]' },
	])
})

Deno.test('prependText adds a text part when content array has none', () => {
	assertEquals(prependText([
		{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
	], 'system: '), [
		{ type: 'text', text: 'system: ' },
		{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
	])
})
