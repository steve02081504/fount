/**
 * 剪贴板粘贴项转换：过滤文本表示项、魔数修正 MIME（图像附件不得被标成 text/*）。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals } from 'jsr:@std/assert'

import { fileFromClipboardItem, sniffMimeFromBuffer } from '../../public/shared/pasteFiles.mjs'

/** 1×1 PNG 测试数据 */
const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
)

/**
 * 构造模拟剪贴板项。
 * @param {'string' | 'file'} kind 项目类别
 * @param {string} type 项目声明类型
 * @param {string} blobType File 的 type
 * @param {string} [name='image.png'] File 名
 * @param {Uint8Array} [bytes=TINY_PNG] 字节内容
 * @returns {{ kind: string, type: string, getAsFile: () => File }} 模拟项
 */
function clipboardItem(kind, type, blobType, name = 'image.png', bytes = TINY_PNG) {
	return {
		kind,
		type,
		/**
		 * @returns {File} 模拟文件
		 */
		getAsFile: () => new File([bytes], name, { type: blobType }),
	}
}

Deno.test('fileFromClipboardItem: skips text-representation items', async () => {
	// 部分浏览器 getAsFile 对 text/html、text/plain 字符串项返回文本 File；
	// 误收会把粘贴的图片附件标成 text/*（AI 提供商收到 text mime 的根因）。
	assertEquals(await fileFromClipboardItem(clipboardItem('string', 'text/html', 'text/html')), null)
	assertEquals(await fileFromClipboardItem(clipboardItem('string', 'text/plain', 'text/plain')), null)
})

Deno.test('fileFromClipboardItem: keeps declared image type', async () => {
	const file = await fileFromClipboardItem(clipboardItem('file', 'image/png', 'image/png'))
	assertEquals(file instanceof File, true)
	assertEquals(file.type, 'image/png')
	assertEquals(/^pasted-\d+-\d+\.png$/.test(file.name), true)
})

Deno.test('fileFromClipboardItem: sniffs image when declared type is text', async () => {
	const file = await fileFromClipboardItem(clipboardItem('file', 'text/plain', 'text/plain'))
	assertEquals(file.type, 'image/png')
	assertEquals(/\.png$/.test(file.name), true)
})

Deno.test('fileFromClipboardItem: sniffs image when declared type is octet-stream', async () => {
	const file = await fileFromClipboardItem(clipboardItem('file', 'application/octet-stream', ''))
	assertEquals(file.type, 'image/png')
})

Deno.test('fileFromClipboardItem: sniffs image when declared type missing', async () => {
	const file = await fileFromClipboardItem(clipboardItem('file', '', ''))
	assertEquals(file.type, 'image/png')
})

Deno.test('fileFromClipboardItem: keeps genuine text type', async () => {
	const bytes = new TextEncoder().encode('hello world')
	const file = await fileFromClipboardItem(clipboardItem('file', 'text/plain', 'text/plain', 'note.txt', bytes))
	assertEquals(file.type, 'text/plain')
})

Deno.test('fileFromClipboardItem: preserves non-default blob name', async () => {
	const file = await fileFromClipboardItem(clipboardItem('file', 'image/png', 'image/png', 'photo.png'))
	assertEquals(file.name, 'photo.png')
})

Deno.test('sniffMimeFromBuffer: returns null for unknown bytes', async () => {
	assertEquals(await sniffMimeFromBuffer(new Uint8Array([1, 2, 3, 4, 5])), null)
	assertEquals(await sniffMimeFromBuffer(null), null)
})
