/**
 * formatGenerationError：把 Error / 数组 / 普通对象统一格式化成可读文本，
 * 避免上层 `String(error)` 退化成 `[object Object]`。
 */
/* global Deno */
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { formatErrorMessage, formatGenerationError } from '../../error_format.mjs'

Deno.test('Error uses its stack', () => {
	const error = new Error('boom')
	assertEquals(formatGenerationError(error), error.stack)
})

Deno.test('Error without stack falls back to message', () => {
	const error = new Error('boom')
	error.stack = ''
	assertEquals(formatGenerationError(error), 'boom')
})

Deno.test('plain object is inspected instead of becoming [object Object]', () => {
	const value = { data: { error: { message: 'Endpoint is unavailable.' } }, response: { status: 503 } }
	const text = formatGenerationError(value)
	assert(text !== '[object Object]')
	assertStringIncludes(text, 'Endpoint is unavailable.')
	assertStringIncludes(text, '503')
})

Deno.test('array elements are formatted and joined', () => {
	const first = new Error('first')
	const second = { code: 500, reason: 'second' }
	const text = formatGenerationError([first, second])
	assertEquals(text, `${formatGenerationError(first)}\n---\n${formatGenerationError(second)}`)
})

Deno.test('primitives and nullish values are inspected', () => {
	assertEquals(formatGenerationError('plain'), '\'plain\'')
	assertEquals(formatGenerationError(null), 'null')
	assertEquals(formatGenerationError(undefined), 'undefined')
})

Deno.test('formatErrorMessage prefers message and falls back to full format', () => {
	assertEquals(formatErrorMessage(new Error('boom')), 'boom')
	assertEquals(formatErrorMessage({ message: 'plain message' }), 'plain message')
	assertEquals(formatErrorMessage(undefined), 'undefined')
	const value = { data: { error: { message: 'Endpoint is unavailable.' } }, response: { status: 503 } }
	const text = formatErrorMessage(value)
	assert(text !== '[object Object]')
	assertStringIncludes(text, 'Endpoint is unavailable.')
})
