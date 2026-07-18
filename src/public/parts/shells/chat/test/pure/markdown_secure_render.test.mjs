/**
 * 安全 Markdown 渲染：allowDangerousHtml:false 时 GetMarkdownConvertor 自动 early 净化 + Mermaid strict；
 * 自产 style/onclick / KaTeX·Mermaid 主题不受影响；输入侧 script / javascript: / 图源 HTML·click·themeCSS 覆盖被忽略。
 */
/* global Deno */
import { assertEquals, assertFalse, assertMatch, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { installMarkdownTestDom } from './markdown_test_dom.mjs'

installMarkdownTestDom()

const { GetMarkdownConvertor } = await import('../../../../../pages/scripts/features/markdown/convertor.mjs')
const { rehypeSanitizeUntrustedContent } = await import('../../../../../pages/scripts/features/markdown/sanitize.mjs')

/**
 * @param {string} markdown 原文
 * @param {object} [options] GetMarkdownConvertor 选项覆盖
 * @returns {Promise<string>} HTML
 */
async function renderSecure(markdown, options = {}) {
	const processor = await GetMarkdownConvertor({
		allowDangerousHtml: false,
		isStandalone: true,
		...options,
	})
	return String(await processor.process(markdown))
}

Deno.test('sanitize plugin strips on* / script / javascript: urls', () => {
	const tree = {
		type: 'root',
		children: [{
			type: 'element',
			tagName: 'p',
			properties: {},
			children: [
				{
					type: 'element',
					tagName: 'a',
					properties: { href: 'javascript:alert(1)', onclick: 'alert(1)' },
					children: [{ type: 'text', value: 'x' }],
				},
				{
					type: 'element',
					tagName: 'script',
					properties: {},
					children: [{ type: 'text', value: 'alert(1)' }],
				},
				{
					type: 'element',
					tagName: 'a',
					properties: { href: 'https://example.com' },
					children: [{ type: 'text', value: 'ok' }],
				},
			],
		}],
	}
	rehypeSanitizeUntrustedContent()()(tree)
	const kids = tree.children[0].children
	assertEquals(kids.length, 2)
	assertEquals(kids[0].properties.onclick, undefined)
	assertEquals(kids[0].properties.href, undefined)
	assertEquals(kids[1].properties.href, 'https://example.com')
})

Deno.test('secure render keeps copy/download but hides unsafe js execute', async () => {
	const html = await renderSecure('```js\nconsole.log(1)\n```')
	assertStringIncludes(html, 'onclick')
	assertMatch(html, /navigator\.clipboard\.writeText/)
	assertMatch(html, /a\.download\s*=/)
	assertStringIncludes(html, 'markdown-code-block')
	assertStringIncludes(html, '<figure')
	assertStringIncludes(html, '<pre')
	assertFalse(html.includes('execution-output'))
	assertFalse(html.includes('createCopyButton'))
	assertFalse(/code_block\.execute/.test(html))
})

Deno.test('secure render keeps safe sql execute button', async () => {
	const html = await renderSecure('```sql\nSELECT 1\n```')
	assertStringIncludes(html, 'markdown-code-block')
	assertMatch(html, /execution-output|createCopyButton/)
	assertMatch(html, /code_block\.execute|Execution/)
})

Deno.test('trusted render keeps unsafe js execute button', async () => {
	const html = await renderSecure('```js\nconsole.log(1)\n```', { allowDangerousHtml: true })
	assertMatch(html, /execution-output|createCopyButton/)
})

Deno.test('secure render keeps safe brainfuck execute button', async () => {
	const html = await renderSecure('```b\n+++\n```')
	assertMatch(html, /execution-output|createCopyButton/)
	assertMatch(html, /code_block\.execute|Execution/)
})

Deno.test('secure render hides html preview button', async () => {
	const html = await renderSecure('```html\n<b>x</b>\n```')
	assertFalse(/code_block\.preview/.test(html))
	assertFalse(/document\.write/.test(html))
})

Deno.test('inline {:lang} stays span>code, not block pre', async () => {
	const html = await renderSecure('前 `内联代码{:js}` 后')
	assertStringIncludes(html, 'data-rehype-pretty-code-figure')
	assertStringIncludes(html, '内联代码')
	assertMatch(html, /<span[^>]*data-rehype-pretty-code-figure[^>]*>[\s\S]*?<code[^>]*data-language="js"/)
	assertFalse(/<span[^>]*data-rehype-pretty-code-figure[^>]*>[\s\S]*?<pre\b/i.test(html))
	assertFalse(html.includes('markdown-code-block'))
})

Deno.test('plain inline code stays bare code without pretty-code figure', async () => {
	const html = await renderSecure('前 `plain` 后')
	assertStringIncludes(html, '<code>plain</code>')
	assertFalse(html.includes('data-rehype-pretty-code-figure'))
})

Deno.test('secure render keeps spoiler onclick + style', async () => {
	const html = await renderSecure('||secret||')
	assertStringIncludes(html, 'class="spoiler"')
	assertStringIncludes(html, 'onclick')
	assertStringIncludes(html, 'color: transparent')
})

Deno.test('secure render keeps KaTeX output classes', async () => {
	const html = await renderSecure('$a=1$')
	assertMatch(html, /class="[^"]*katex/)
})

Deno.test('secure render keeps Mermaid theme CSS (converter-owned)', async () => {
	const html = await renderSecure('```mermaid\nflowchart TD\n  A-->B\n```')
	assertFalse(html.includes('mermaid-error-fallback'))
	assertStringIncludes(html, '<style')
	assertStringIncludes(html, 'var(--color-base')
	assertMatch(html, /flowchart|mermaid-/i)
})

Deno.test('secure render ignores raw HTML script from input', async () => {
	const html = await renderSecure('<script>alert(1)</script>\n\nok')
	assertFalse(/<script[\s>]/i.test(html))
	assertStringIncludes(html, 'ok')
})

Deno.test('secure render strips javascript: link href', async () => {
	const html = await renderSecure('[x](javascript:alert(1))')
	assertFalse(/javascript:/i.test(html))
})

Deno.test('secure render ignores Mermaid click + HTML label from diagram source', async () => {
	const html = await renderSecure(`\`\`\`mermaid
flowchart TD
  A["<img src=x onerror=alert(1)>"]
  click A href "javascript:alert(1)"
\`\`\``)
	assertFalse(/onerror=/i.test(html))
	assertFalse(/javascript:alert/i.test(html))
	assertFalse(/<img\b/i.test(html))
})

Deno.test('secure render ignores Mermaid frontmatter themeCSS override', async () => {
	const html = await renderSecure(`\`\`\`mermaid
%%{init: {'themeCSS': '.evil-marker{outline:2px solid red}'}}%%
flowchart TD
  A-->B
\`\`\``)
	assertFalse(html.includes('evil-marker'))
	assertStringIncludes(html, 'var(--color-base')
})

Deno.test('late sanitize via extraRehypePlugins still strips converter onclick — do not do this', async () => {
	const html = await renderSecure('```js\nconsole.log(1)\n```', {
		extraRehypePlugins: [rehypeSanitizeUntrustedContent()],
	})
	// 末尾再挂一遍净化会杀掉自产 onclick（故 API 只在 early 自动挂）
	assertFalse(html.includes('onclick'))
})

Deno.test('trusted pipeline (allowDangerousHtml) keeps inline HTML', async () => {
	const html = await renderSecure('<b>bold</b>', { allowDangerousHtml: true })
	assertStringIncludes(html, '<b>bold</b>')
})
