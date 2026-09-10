/**
 * 安全 Markdown 渲染管线（前端实跑）：allowDangerousHtml:false 时 GetMarkdownConvertor 自动 early 净化 + Mermaid strict；
 * 自产 style/onclick / KaTeX·Mermaid 主题不受影响；输入侧 script / javascript: / 图源 HTML·click·themeCSS 覆盖被忽略。
 *
 * 浏览器模块必须在浏览器里测（后端 Deno 测试装 DOM shim 会被 no_dom_shim 预载当场爆炸）；
 * 通过 modulePage 在真实页面 evaluate convertor，断言回 Node 侧。
 */
import { expect, test } from './fixtures.mjs'

const SECURE = { allowDangerousHtml: false }
const TRUSTED = { allowDangerousHtml: true }

/**
 * 在模块逻辑页里渲染 markdown（复用浏览器自带的 getConvertor 缓存）。
 * @param {import('fount/scripts/test/playwright/module_page.mjs').ModulePage} modulePage 模块逻辑页
 * @param {string} markdown 原文
 * @param {{ allowDangerousHtml?: boolean }} [options] 信任档
 * @param {string} [cacheKey] 页面侧 rehype 缓存属性名；同一 key 跨次渲染共享同一缓存
 * @returns {Promise<string>} HTML
 */
async function renderMarkdown(modulePage, markdown, options = SECURE, cacheKey) {
	return modulePage.run(async arg => {
		const md = await import('/scripts/features/markdown/index.mjs')
		const cache = arg.cacheKey
			? (globalThis.__fountModulePage[arg.cacheKey] ??= { common: {}, specific: {} })
			: undefined
		return md.renderMarkdownAsString(arg.markdown, cache, { allowDangerousHtml: arg.options.allowDangerousHtml, isStandalone: true })
	}, { markdown, options, cacheKey })
}

/**
 * 解析代码块 figure 上各按钮的 aria-label，并回传浏览器侧 geti18n 的对应键值。
 * @param {import('fount/scripts/test/playwright/module_page.mjs').ModulePage} modulePage 模块逻辑页
 * @param {string} html 渲染结果
 * @returns {Promise<{ labels: string[], copyLabel: string, downloadLabel: string, executeLabel: string, previewLabel: string }>} aria-label 列表与 i18n 键值
 */
async function codeBlockButtonLabels(modulePage, html) {
	return modulePage.run(async arg => {
		const doc = new DOMParser().parseFromString(`<div id="root">${arg.html}</div>`, 'text/html')
		const labels = [...doc.querySelectorAll('[aria-label]')].map(el => el.getAttribute('aria-label'))
		const { geti18n } = await import('/scripts/i18n/index.mjs')
		return {
			labels,
			copyLabel: geti18n('util.code_block.copy.aria-label'),
			downloadLabel: geti18n('util.code_block.download.aria-label'),
			executeLabel: geti18n('util.code_block.execute.aria-label'),
			previewLabel: geti18n('util.code_block.preview.aria-label'),
		}
	}, { html })
}

test.describe('markdown secure render', () => {
	test.describe.configure({ timeout: 600_000 })

	test('sanitize plugin strips on* / script / javascript: urls', async ({ modulePage }) => {
		const kids = await modulePage.run(async () => {
			const { rehypeSanitizeUntrustedContent } = await import('/scripts/features/markdown/sanitize.mjs')
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
			return tree.children[0].children.map(kid => ({ onclick: kid.properties.onclick, href: kid.properties.href }))
		})
		expect(kids).toHaveLength(2)
		expect(kids[0].onclick).toBeUndefined()
		expect(kids[0].href).toBeUndefined()
		expect(kids[1].href).toBe('https://example.com')
	})

	test('secure render keeps copy/download but hides unsafe js execute', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '```js\nconsole.log(1)\n```')
		const { labels, copyLabel, downloadLabel, executeLabel } = await codeBlockButtonLabels(modulePage, html)
		expect(html).toContain('onclick')
		expect(html).toMatch(/navigator\.clipboard\.writeText/)
		expect(html).toMatch(/a\.download\s*=/)
		expect(html).toContain('markdown-code-block')
		expect(html).toContain('<figure')
		expect(html).not.toContain('execution-output')
		expect(html).not.toContain('createCopyButton')
		expect(html).not.toMatch(/code_block\.execute/)
		expect(labels).toContain(copyLabel)
		expect(labels).toContain(downloadLabel)
		expect(labels).not.toContain(executeLabel)
	})

	test('secure render keeps safe sql execute button', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '```sql\nSELECT 1\n```')
		const { labels, executeLabel } = await codeBlockButtonLabels(modulePage, html)
		expect(html).toContain('markdown-code-block')
		expect(html).toMatch(/execution-output|codeblock-execution/)
		expect(labels).toContain(executeLabel)
	})

	test('trusted render keeps unsafe js execute button', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '```js\nconsole.log(1)\n```', TRUSTED)
		const { labels, executeLabel } = await codeBlockButtonLabels(modulePage, html)
		expect(labels).toContain(executeLabel)
	})

	test('secure render keeps safe brainfuck execute button', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '```b\n+++\n```')
		const { labels, executeLabel } = await codeBlockButtonLabels(modulePage, html)
		expect(html).toMatch(/execution-output|codeblock-execution/)
		expect(labels).toContain(executeLabel)
	})

	test('secure render hides html preview button', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '```html\n<b>x</b>\n```')
		const { labels, previewLabel } = await codeBlockButtonLabels(modulePage, html)
		expect(labels).not.toContain(previewLabel)
		expect(html).not.toContain('document.write')
	})

	test('inline {:lang} stays span>code, not block pre', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '前 `内联代码{:js}` 后')
		expect(html).toContain('data-rehype-pretty-code-figure')
		expect(html).toContain('内联代码')
		expect(html).toMatch(/<span[^>]*data-rehype-pretty-code-figure[^>]*>[\S\s]*?<code[^>]*data-language="js"/)
		expect(html).not.toMatch(/<span[^>]*data-rehype-pretty-code-figure[^>]*>[\S\s]*?<pre\b/i)
		expect(html).not.toContain('markdown-code-block')
	})

	test('plain inline code stays bare code without pretty-code figure', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '前 `plain` 后')
		expect(html).toContain('<code>plain</code>')
		expect(html).not.toContain('data-rehype-pretty-code-figure')
	})

	test('CJK emphasis works without surrounding spaces (fullwidth punctuation)', async ({ modulePage }) => {
		// CommonMark 默认要求标记外侧为空白/标点；全角括号 + 后接汉字会让关闭标记无法 right-flanking
		const html = await renderMarkdown(modulePage, '它是**自带（builtin）**来源')
		expect(html).toContain('<strong>自带（builtin）</strong>')
		expect(html).not.toContain('**自带')
	})

	test('CJK GFM strikethrough works without surrounding spaces', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '这是~~删除（test）~~文本')
		expect(html).toContain('<del>删除（test）</del>')
		expect(html).not.toContain('~~删除')
	})

	test('secure render keeps spoiler onclick + style', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '||secret||')
		expect(html).toContain('class="spoiler"')
		expect(html).toContain('onclick')
		expect(html).toContain('color: transparent')
	})

	test('secure render keeps KaTeX output classes', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '$a=1$')
		expect(html).toMatch(/class="[^"]*katex/)
	})

	test('secure render keeps Mermaid theme CSS (converter-owned)', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '```mermaid\nflowchart TD\n  A-->B\n```')
		expect(html).not.toContain('mermaid-error-fallback')
		expect(html).toContain('<style')
		expect(html).toContain('var(--color-base')
		expect(html).toMatch(/flowchart|mermaid-/i)
	})

	test('same Mermaid source twice gets distinct svg ids and non-empty graphs', async ({ modulePage }) => {
		const md = '```mermaid\nflowchart TD\n  A-->B\n```'
		const html1 = await renderMarkdown(modulePage, md, SECURE, 'mermaidCache')
		const html2 = await renderMarkdown(modulePage, md, SECURE, 'mermaidCache')
		expect(html1).not.toContain('mermaid-error-fallback')
		expect(html2).not.toContain('mermaid-error-fallback')
		const check = await modulePage.run(async arg => {
			const id1 = arg.html1.match(/<svg\b[^>]*\bid="(mermaid-[^"]+)"/i)?.[1]
			const id2 = arg.html2.match(/<svg\b[^>]*\bid="(mermaid-[^"]+)"/i)?.[1]
			// 模拟 social：两份 HTML 同时挂进 DOM，id 不得冲突（挂 detached host，避免 page-watch 扫描）
			const host = document.createElement('div')
			host.innerHTML = arg.html1 + arg.html2
			return {
				id1, id2,
				id1Count: id1 ? host.querySelectorAll(`svg[id="${id1}"]`).length : 0,
				id2Count: id2 ? host.querySelectorAll(`svg[id="${id2}"]`).length : 0,
				total: host.querySelectorAll('svg[id^="mermaid-"]').length,
				nodeLabels: [arg.html1.includes('nodeLabel'), arg.html2.includes('nodeLabel')],
				nodeA: [arg.html1.includes('>A<'), arg.html2.includes('>A<')],
			}
		}, { html1, html2 })
		expect(typeof check.id1).toBe('string')
		expect(typeof check.id2).toBe('string')
		expect(check.id1).not.toBe(check.id2)
		expect(check.nodeLabels).toEqual([true, true])
		expect(check.nodeA).toEqual([true, true])
		expect(check.id1Count).toBe(1)
		expect(check.id2Count).toBe(1)
		expect(check.total).toBe(2)
	})

	test('secure render ignores raw HTML script from input', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '<script>alert(1)</script>\n\nok')
		expect(html).not.toMatch(/<script[\s>]/i)
		expect(html).toContain('ok')
	})

	test('secure render strips javascript: link href', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '[x](javascript:alert(1))')
		expect(html).not.toMatch(/javascript:/i)
	})

	test('secure render ignores Mermaid click + HTML label from diagram source', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '```mermaid\nflowchart TD\n  A["<img src=x onerror=alert(1)>"]\n  click A href "javascript:alert(1)"\n```')
		// 真实 mermaid（strict）可能保留惰性 <img>（纯资源加载、事件处理器被净化）与无 href 的节点链接；
		// 安全不变量是：事件处理器 / javascript: 跳转 / 内联脚本一律不得出现（脚本激活面为零）。
		expect(html).not.toMatch(/onerror/i)
		expect(html).not.toMatch(/javascript:alert/i)
		expect(html).not.toMatch(/<script[\s>]/i)
	})

	test('secure render ignores Mermaid frontmatter themeCSS override', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '```mermaid\n%%{init: {\'themeCSS\': \'.evil-marker{outline:2px solid red}\'}}%%\nflowchart TD\n  A-->B\n```')
		expect(html).not.toContain('evil-marker')
		expect(html).toContain('var(--color-base')
	})

	test('secure render marks untrusted img with svg-inliner-ignore', async ({ modulePage }) => {
		// markdown 语法图片应禁止 svgInliner 内联（远程 .svg 可携带脚本）；raw <img> 未信任档直接丢弃
		const html = await renderMarkdown(modulePage, '![](https://attacker.example/poc.svg)\n\n<img src="https://attacker.example/x.svg">')
		expect(html).toMatch(/<img[^>]*src="https:\/\/attacker\.example\/poc\.svg"[^>]*svg-inliner-ignore/)
		expect(html).not.toContain('x.svg')
		expect(html).not.toMatch(/<script[\s>]/i)
	})

	test('late sanitize via extraRehypePlugins still strips converter onclick — do not do this', async ({ modulePage }) => {
		const html = await modulePage.run(async () => {
			const { GetMarkdownConvertor } = await import('/scripts/features/markdown/convertor.mjs')
			const { rehypeSanitizeUntrustedContent } = await import('/scripts/features/markdown/sanitize.mjs')
			const processor = await GetMarkdownConvertor({ allowDangerousHtml: false, isStandalone: true, extraRehypePlugins: [rehypeSanitizeUntrustedContent()] })
			return String(await processor.process('```js\nconsole.log(1)\n```'))
		})
		// 末尾再挂一遍净化会杀掉自产 onclick（故 API 只在 early 自动挂）
		expect(html).not.toContain('onclick')
	})

	test('trusted pipeline (allowDangerousHtml) keeps inline HTML', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '<b>bold</b>', TRUSTED)
		expect(html).toContain('<b>bold</b>')
	})

	test('trusted render marks markdown img with svg-inliner-ignore', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '![](https://attacker.example/poc.svg)', TRUSTED)
		expect(html).toMatch(/<img[^>]*src="https:\/\/attacker\.example\/poc\.svg"[^>]*svg-inliner-ignore/)
	})

	test('titled code block joins header alert and body as join-items under a join-vertical figure', async ({ modulePage }) => {
		const html = await renderMarkdown(modulePage, '```powershell title="正在执行PowerShell"\necho hi\n```')
		const shape = await modulePage.run(async arg => {
			const doc = new DOMParser().parseFromString(`<div class="markdown-body">${arg.html}</div>`, 'text/html')
			const figure = doc.querySelector('figure')
			const kids = [...figure.children]
			const header = kids.find(kid => kid.classList.contains('alert'))
			const body = kids.find(kid => kid.classList.contains('markdown-code-block'))
			return {
				join: figure.classList.contains('join'),
				joinVertical: figure.classList.contains('join-vertical'),
				headerIsJoinItem: header?.classList.contains('join-item'),
				bodyIsJoinItem: body?.classList.contains('join-item'),
				headerFirst: kids[0] === header,
				bodyLast: kids[kids.length - 1] === body,
			}
		}, { html })
		// 抬头在前、代码块在后：接缝处双方都应无圆角
		expect(shape.join).toBe(true)
		expect(shape.joinVertical).toBe(true)
		expect(shape.headerIsJoinItem).toBe(true)
		expect(shape.bodyIsJoinItem).toBe(true)
		expect(shape.headerFirst).toBe(true)
		expect(shape.bodyLast).toBe(true)
	})

	test('injected markdown style squares code-block corners at join seams', async ({ modulePage }) => {
		// 先 import convertor（样式注入发生在模块顶层），再断言 head 里的注入样式
		const css = await modulePage.run(async () => {
			await import('/scripts/features/markdown/convertor.mjs')
			return [...document.head.querySelectorAll('style')].map(style => style.textContent).join('\n')
		})
		expect(css).toMatch(/\.join-vertical > \.markdown-code-block:not\(:first-child\)/)
		expect(css).toMatch(/\.join-vertical > \.markdown-code-block:not\(:last-child\)/)
	})
})
