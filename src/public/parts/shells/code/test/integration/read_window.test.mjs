/* global Deno */
/**
 * 读文件窗口与截断护栏 · 单元测试。
 */
import { Buffer } from 'node:buffer'

import { assert, assertEquals } from 'jsr:@std/assert'

import {
	DEFAULT_READ_MAX_CHARS,
	DEFAULT_READ_MAX_LINES,
	DEFAULT_READ_MAX_LINE_CHARS,
	formatReadWindowNotice,
	isProbablyTextBuffer,
	parseReadWindow,
	windowText,
} from '../../../../plugins/file-operations/src/read_window.mjs'

Deno.test('parseReadWindow defaults and parsing', () => {
	assertEquals(parseReadWindow(), {
		offset: 1,
		limit: DEFAULT_READ_MAX_LINES,
		maxLineChars: DEFAULT_READ_MAX_LINE_CHARS,
		maxChars: DEFAULT_READ_MAX_CHARS,
	})
	assertEquals(parseReadWindow({ offset: '5', limit: '10', 'max-line-chars': '80', 'max-chars': '0' }), {
		offset: 5, limit: 10, maxLineChars: 80, maxChars: 0,
	})
	assertEquals(parseReadWindow({ offset: '-3', limit: 'abc' }).offset, 1)
})

Deno.test('windowText keeps small files intact', () => {
	const result = windowText('a\nb\nc')
	assertEquals(result.text, 'a\nb\nc')
	assertEquals(result.totalLines, 3)
	assertEquals(result.startLine, 1)
	assertEquals(result.endLine, 3)
	assert(!result.truncatedByLines && !result.truncatedByChars && !result.truncatedLineCount)
	assertEquals(formatReadWindowNotice(result), '')
})

Deno.test('windowText applies offset and limit', () => {
	const result = windowText('1\n2\n3\n4\n5', { offset: 2, limit: 2 })
	assertEquals(result.text, '2\n3')
	assertEquals(result.startLine, 2)
	assertEquals(result.endLine, 3)
	assert(result.truncatedByLines)
	const notice = formatReadWindowNotice(result)
	assert(notice.includes('第 2-3 行'), '应提示区间')
	assert(notice.includes('offset="4"'), '应提示续读偏移')
})

Deno.test('windowText reports out-of-range offset', () => {
	const result = windowText('a\nb', { offset: 99 })
	assert(result.outOfRange)
	assertEquals(result.text, '')
	assert(formatReadWindowNotice(result).includes('超出文件总行数 2'))
})

Deno.test('windowText truncates long lines', () => {
	const long = 'x'.repeat(50)
	const result = windowText(`short\n${long}`, { maxLineChars: 10 })
	assertEquals(result.truncatedLineCount, 1)
	assert(result.text.split('\n')[1].startsWith('xxxxxxxxxx …[本行已截断，共 50 字符]'))
})

Deno.test('windowText stops at total char cap', () => {
	const result = windowText('aaaa\nbbbb\ncccc', { maxChars: 6, maxLineChars: 0 })
	assert(result.truncatedByChars)
	assertEquals(result.text, 'aaaa')
	assert(formatReadWindowNotice(result).includes('总体字符上限'))
})

Deno.test('windowText always returns at least one line under a tiny cap', () => {
	const result = windowText('aaaa\nbbbb', { maxChars: 1, maxLineChars: 0 })
	assert(result.truncatedByChars)
	assertEquals(result.text, 'aaaa')
})

Deno.test('windowText normalizes CRLF and counts lines', () => {
	const result = windowText('a\r\nb\r\nc', { offset: 2, limit: 1 })
	assertEquals(result.totalLines, 3)
	assertEquals(result.text, 'b')
})

Deno.test('isProbablyTextBuffer detects NUL bytes', () => {
	assert(isProbablyTextBuffer(Buffer.from('hello world')))
	assert(!isProbablyTextBuffer(Buffer.from([0x68, 0x00, 0x69])))
})
