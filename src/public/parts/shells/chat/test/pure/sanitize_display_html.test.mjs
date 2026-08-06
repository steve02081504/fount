/**
 * sanitizePermissiveHtml：保留排版，剥 script / on* / 危险 URL。
 */
/* global Deno */
import { assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert'

import { installMarkdownTestDom } from './markdown_test_dom.mjs'

installMarkdownTestDom()

const { isSafeHtmlUrl, sanitizePermissiveHtml, scrubHtmlActivePayload } = await import('../../../../../pages/scripts/lib/sanitizeHtml.mjs')

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

Deno.test('sanitizePermissiveHtml strips protocol-relative // urls', () => {
	const html = sanitizePermissiveHtml('<a href="//evil.example/x">x</a><img src="//evil.example/t.gif">')
	assertFalse(/\/\/evil\.example/i.test(html))
})

Deno.test('isSafeHtmlUrl rejects // and javascript:', () => {
	assertEquals(isSafeHtmlUrl('//evil.example/x'), false)
	assertEquals(isSafeHtmlUrl('javascript:alert(1)'), false)
	assertEquals(isSafeHtmlUrl('https://example.com'), true)
	assertEquals(isSafeHtmlUrl('/api/x'), true)
})

Deno.test('sanitizePermissiveHtml strips svg and srcset', () => {
	const html = sanitizePermissiveHtml('<svg onload=alert(1)></svg><img srcset="javascript:alert(1)">')
	assertFalse(/<svg/i.test(html))
	assertFalse(/srcset/i.test(html))
})

Deno.test('sanitizePermissiveHtml strips style attributes', () => {
	const html = sanitizePermissiveHtml('<span style="background:url(https://evil.example/x);position:fixed;top:0">x</span>')
	assertFalse(/\bstyle\b/i.test(html))
	assertStringIncludes(html, '<span')
})

Deno.test('scrubHtmlActivePayload keeps structure, strips on* and javascript:', () => {
	const fragment = /** @type {DocumentFragment} */ (scrubHtmlActivePayload(
		'<details open><summary onclick="x()">s</summary><a href="javascript:alert(1)">t</a><svg onload="y()" style="color:red"></svg></details>',
	))
	const host = document.createElement('div')
	host.appendChild(fragment)
	assertStringIncludes(host.innerHTML, '<details')
	assertStringIncludes(host.innerHTML, '<svg')
	assertStringIncludes(host.innerHTML, 'style=')
	assertFalse(/onclick/i.test(host.innerHTML))
	assertFalse(/onload/i.test(host.innerHTML))
	assertFalse(/javascript:/i.test(host.innerHTML))
})

Deno.test('scrubHtmlActivePayload mutates DOM root in place', () => {
	const host = document.createElement('div')
	host.setAttribute('onclick', 'host()')
	host.setAttribute('href', 'javascript:alert(1)')
	host.innerHTML = '<p onclick="x()">ok</p>'
	const returned = scrubHtmlActivePayload(host)
	assertEquals(returned, host)
	assertFalse(host.hasAttribute('onclick'))
	assertFalse(host.hasAttribute('href'))
	assertFalse(/onclick/i.test(host.innerHTML))
})
