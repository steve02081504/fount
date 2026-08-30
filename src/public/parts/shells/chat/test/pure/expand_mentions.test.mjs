/**
 * @提及展示名转义：displayName / 角色名作为链接 label 拼进 Markdown 时必须转义，
 * 否则恶意名称里的 raw HTML（如 `<img onerror>`）会在本机消息 trusted 档渲染时执行（XSS）。
 * `expandMentionsInMarkdown`（browser import social runUri）内部即调用此函数。
 */
/* global Deno */
import { assertFalse, assertStringIncludes } from 'jsr:@std/assert'

import { escapeMentionLabel } from 'fount/public/parts/shells/chat/public/shared/mentions.mjs'

const EVIL_NAME = '<img src=x onerror=alert(1)>'

Deno.test('escapeMentionLabel escapes raw HTML in displayName', () => {
	const escaped = escapeMentionLabel(EVIL_NAME)
	assertStringIncludes(escaped, '&lt;img src=x onerror=alert(1)&gt;')
	assertFalse(/<img[\s>]/i.test(escaped))
	assertFalse(/<img[^>]*onerror/i.test(escaped))
})

Deno.test('escapeMentionLabel escapes quotes for attribute context', () => {
	const escaped = escapeMentionLabel('"><img src=x onerror=alert(1)>')
	assertStringIncludes(escaped, '&quot;&gt;&lt;img')
	assertFalse(escaped.includes('"'))
	assertFalse(/<img[\s>]/i.test(escaped))
})

Deno.test('escapeMentionLabel keeps plain labels untouched', () => {
	assertStringIncludes(escapeMentionLabel('alice'), 'alice')
	assertStringIncludes(escapeMentionLabel(''), '')
	assertStringIncludes(escapeMentionLabel(null), '')
})