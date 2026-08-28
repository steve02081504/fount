/**
 * 安全 Markdown 渲染：allowDangerousHtml:false 时 GetMarkdownConvertor 自动 early 净化 + Mermaid strict；
 * 自产 style/onclick / KaTeX·Mermaid 主题不受影响；输入侧 script / javascript: / 图源 HTML·click·themeCSS 覆盖被忽略。
 */
/* global Deno */
import { assert, assertEquals, assertFalse, assertMatch, assertStringIncludes } from 'jsr:@std/assert'

import { installMarkdownTestDom } from './markdown_test_dom.mjs'

installMarkdownTestDom()

const { GetMarkdownConvertor } = await import('../../../../../pages/scripts/features/markdown/convertor.mjs')
const { rehypeSanitizeUntrustedContent } = await import('../../../../../pages/scripts/features/markdown/sanitize.mjs')

/**
 * 本文件无 i18n bundle，独立代码块渲染会触发 `[i18n:missing]` 告警（噪声）；断言依赖 key 字符串回退，
 * 不加载 bundle，故静默该告警。告警经 i18n 模块自己持有的 `console` 发出（`deno test` 运行器会替换
 * `globalThis.console`，故须直接 patch i18n 导出的 `console`），模块顶层安装一次即可全程生效；其余 warn 照常透传。
 */
{
	const i18nMod = await import('../../../../../pages/scripts/i18n/index.mjs')
	const origWarn = i18nMod.console.warn
	/**
	 * 过滤 `[i18n:missing]` 噪声告警，其余告警照常透传。
	 * @param {...any} args 原始日志参数
	 */
	i18nMod.console.warn = (...args) => {
		if (/\[i18n:missing]/.test(String(args[0]))) return
		origWarn(...args)
	}
}

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
	assertMatch(html, /<span[^>]*data-rehype-pretty-code-figure[^>]*>[\S\s]*?<code[^>]*data-language="js"/)
	assertFalse(/<span[^>]*data-rehype-pretty-code-figure[^>]*>[\S\s]*?<pre\b/i.test(html))
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

Deno.test('same Mermaid source twice gets distinct svg ids and non-empty graphs', async () => {
	const md = '```mermaid\nflowchart TD\n  A-->B\n```'
	const cache = { common: {}, specific: {} }
	const processor = await GetMarkdownConvertor({
		allowDangerousHtml: false,
		isStandalone: true,
	})
	const html1 = String(await processor.process({ value: md, data: { cache } }))
	const html2 = String(await processor.process({ value: md, data: { cache } }))
	assertFalse(html1.includes('mermaid-error-fallback'))
	assertFalse(html2.includes('mermaid-error-fallback'))

	const id1 = html1.match(/<svg\b[^>]*\bid="(mermaid-[^"]+)"/i)?.[1]
	const id2 = html2.match(/<svg\b[^>]*\bid="(mermaid-[^"]+)"/i)?.[1]
	assertEquals(typeof id1, 'string')
	assertEquals(typeof id2, 'string')
	assertFalse(id1 === id2)

	// 图节点文案应在；撞 id 时二次结果常只剩 style + 空壳
	assertStringIncludes(html1, 'nodeLabel')
	assertStringIncludes(html2, 'nodeLabel')
	assertStringIncludes(html1, '>A<')
	assertStringIncludes(html2, '>A<')

	// 模拟 social：两份 HTML 同时挂进 DOM，id 不得冲突
	const host = document.createElement('div')
	host.innerHTML = html1 + html2
	document.body.appendChild(host)
	assertEquals(host.querySelectorAll(`svg[id="${id1}"]`).length, 1)
	assertEquals(host.querySelectorAll(`svg[id="${id2}"]`).length, 1)
	assertEquals(host.querySelectorAll('svg[id^="mermaid-"]').length, 2)
	host.remove()
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

Deno.test('titled code block joins header alert and body as join-items under a join-vertical figure', async () => {
	const html = await renderSecure('```powershell title="正在执行PowerShell"\necho hi\n```')
	const doc = new DOMParser().parseFromString(`<div class="markdown-body">${html}</div>`, 'text/html')
	const figure = doc.querySelector('figure')
	assert(figure.classList.contains('join'))
	assert(figure.classList.contains('join-vertical'))
	const kids = [...figure.children]
	const header = kids.find(k => k.classList.contains('alert'))
	const body = kids.find(k => k.classList.contains('markdown-code-block'))
	assert(header?.classList.contains('join-item'))
	assert(body?.classList.contains('join-item'))
	// 抬头在前、代码块在后：接缝处双方都应无圆角
	assertEquals(kids[0], header)
	assertEquals(kids[kids.length - 1], body)
})

Deno.test('injected markdown style squares code-block corners at join seams', () => {
	const css = [...document.head.querySelectorAll('style')].map(s => s.textContent).join('\n')
	assertMatch(css, /\.join-vertical > \.markdown-code-block:not\(:first-child\)/)
	assertMatch(css, /\.join-vertical > \.markdown-code-block:not\(:last-child\)/)
})
