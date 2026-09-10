/**
 * sanitizePermissiveHtml（前端实跑）：保留排版，剥 script / on* / 危险 URL。
 * 浏览器模块必须在浏览器里测（modulePage + page.evaluate），断言回 Node 侧。
 */
import { expect, test } from './fixtures.mjs'

/**
 * 在模块逻辑页里跑 sanitizePermissiveHtml。
 * @param {import('fount/scripts/test/playwright/module_page.mjs').ModulePage} modulePage 模块逻辑页
 * @param {string} markdown 待净化的 HTML
 * @returns {Promise<string>} 净化后的 HTML
 */
function withSanitizeHtml(modulePage, markdown) {
	return modulePage.run(async markdown => {
		const { sanitizePermissiveHtml } = await import('/scripts/lib/sanitizeHtml.mjs')
		return sanitizePermissiveHtml(markdown)
	}, markdown)
}

test.describe('sanitizePermissiveHtml', () => {
	test.describe.configure({ timeout: 600_000 })

	test('keeps bold, strips script and onclick', async ({ modulePage }) => {
		const html = await withSanitizeHtml(modulePage, '<b>hi</b><script>alert(1)</script><img src=x onerror=alert(1)>')
		expect(html).toContain('<b>hi</b>')
		expect(html).not.toMatch(/<script/i)
		expect(html).not.toMatch(/onerror/i)
		expect(html).toContain('<img')
	})

	test('strips javascript: href', async ({ modulePage }) => {
		const html = await withSanitizeHtml(modulePage, '<a href="javascript:alert(1)">x</a>')
		expect(html).not.toMatch(/javascript:/i)
		expect(html).toContain('<a')
	})

	test('keeps https link', async ({ modulePage }) => {
		const html = await withSanitizeHtml(modulePage, '<a href="https://example.com">ok</a>')
		expect(html).toContain('href="https://example.com"')
	})

	test('strips protocol-relative // urls', async ({ modulePage }) => {
		const html = await withSanitizeHtml(modulePage, '<a href="//evil.example/x">x</a><img src="//evil.example/t.gif">')
		expect(html).not.toMatch(/\/\/evil\.example/i)
	})

	test('strips protocol-relative /\\ urls', async ({ modulePage }) => {
		const html = await withSanitizeHtml(modulePage, '<a href="/\\evil.example/x">x</a><img src="/\\evil.example/t.gif">')
		expect(html).not.toMatch(/evil\.example/i)
	})

	test('isSafeHtmlUrl rejects // and /\\ and javascript:', async ({ modulePage }) => {
		const results = await modulePage.run(async () => {
			const { isSafeHtmlUrl } = await import('/scripts/lib/sanitizeHtml.mjs')
			return {
				protocolRelative: isSafeHtmlUrl('//evil.example/x'),
				backslash: isSafeHtmlUrl('/\\evil.example/x'),
				javascript: isSafeHtmlUrl('javascript:alert(1)'),
				https: isSafeHtmlUrl('https://example.com'),
				apiPath: isSafeHtmlUrl('/api/x'),
			}
		})
		expect(results.protocolRelative).toBe(false)
		expect(results.backslash).toBe(false)
		expect(results.javascript).toBe(false)
		expect(results.https).toBe(true)
		expect(results.apiPath).toBe(true)
	})

	test('strips svg and srcset', async ({ modulePage }) => {
		const html = await withSanitizeHtml(modulePage, '<svg onload=alert(1)></svg><img srcset="javascript:alert(1)">')
		expect(html).not.toMatch(/<svg/i)
		expect(html).not.toMatch(/srcset/i)
	})

	test('strips style attributes', async ({ modulePage }) => {
		const html = await withSanitizeHtml(modulePage, '<span style="background:url(https://evil.example/x);position:fixed;top:0">x</span>')
		expect(html).not.toMatch(/\bstyle\b/i)
		expect(html).toContain('<span')
	})

	test('scrubHtmlActivePayload keeps structure, strips on* and javascript:', async ({ modulePage }) => {
		const result = await modulePage.run(async () => {
			const { scrubHtmlActivePayload } = await import('/scripts/lib/sanitizeHtml.mjs')
			const fragment = scrubHtmlActivePayload(
				'<details open><summary onclick="x()">s</summary><a href="javascript:alert(1)">t</a><svg onload="y()" style="color:red"></svg></details>',
			)
			const host = document.createElement('div')
			host.appendChild(fragment)
			return host.innerHTML
		})
		expect(result).toContain('<details')
		expect(result).toContain('<svg')
		expect(result).toContain('style=')
		expect(result).not.toMatch(/onclick/i)
		expect(result).not.toMatch(/onload/i)
		expect(result).not.toMatch(/javascript:/i)
	})

	test('scrubHtmlActivePayload mutates DOM root in place', async ({ modulePage }) => {
		const result = await modulePage.run(async () => {
			const { scrubHtmlActivePayload } = await import('/scripts/lib/sanitizeHtml.mjs')
			const host = document.createElement('div')
			host.setAttribute('onclick', 'host()')
			host.setAttribute('href', 'javascript:alert(1)')
			host.innerHTML = '<p onclick="x()">ok</p>'
			const same = scrubHtmlActivePayload(host) === host
			return {
				same,
				onclick: host.hasAttribute('onclick'),
				href: host.hasAttribute('href'),
				innerHTML: host.innerHTML,
			}
		})
		expect(result.same).toBe(true)
		expect(result.onclick).toBe(false)
		expect(result.href).toBe(false)
		expect(result.innerHTML).not.toMatch(/onclick/i)
	})
})
