/**
 * sanitizePermissiveHtml：保留排版，剥 script / on* / 危险 URL。
 */
/* global Deno */
import { assertFalse, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { installMarkdownTestDom } from './markdown_test_dom.mjs'

installMarkdownTestDom()

const { sanitizePermissiveHtml } = await import('../../../../../pages/scripts/lib/sanitizeHtml.mjs')

Deno.test('sanitizePermissiveHtml keeps bold, strips script and onclick', () => {
	const html = sanitizePermissiveHtml('<b>hi</b><script>alert(1)</script><img src=x onerror=alert(1)>')
	assertStringIncludes(html, '<b>hi</b>')
	assertFalse(/<script/i.test(html))
	assertFalse(/onerror/i.test(html))
	assertStringIncludes(html, '<img')
})

Deno.test('sanitizePermissiveHtml strips javascript: href', () => {
	const html = sanitizePermissiveHtml('<a href="javascript:alert(1)">x</a>')
	assertFalse(/javascript:/i.test(html))
	assertStringIncludes(html, '<a')
})

Deno.test('sanitizePermissiveHtml keeps https link', () => {
	const html = sanitizePermissiveHtml('<a href="https://example.com">ok</a>')
	assertStringIncludes(html, 'href="https://example.com"')
})
