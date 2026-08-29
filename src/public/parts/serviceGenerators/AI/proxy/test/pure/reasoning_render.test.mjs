/**
 * reasoning `<details>` 块与正文拼接后必须走 Markdown 渲染：
 * CommonMark raw HTML 块直到空行才结束，`</details>` 后无空行会把整段正文
 * 吞进 HTML 块，`**bold**` 原样输出（甚至未信任档整条变空）。
 */
/* global Deno */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { installMarkdownTestDom } from '../../../../../shells/chat/test/pure/markdown_test_dom.mjs'

installMarkdownTestDom()

const { GetMarkdownConvertor } = await import('../../../../../../pages/scripts/features/markdown/convertor.mjs')
const { buildReasoningDetailsMarkdown } = await import('../../src/reasoningRenderer.mjs')

/**
 * @param {string} markdown 原文
 * @param {boolean} allowDangerousHtml 信任档
 * @returns {Promise<string>} HTML
 */
async function render(markdown, allowDangerousHtml) {
	const processor = await GetMarkdownConvertor({ allowDangerousHtml, isStandalone: true })
	return String(await processor.process(markdown))
}

Deno.test('buildReasoningDetailsMarkdown output ends with blank line (two newlines)', () => {
	const reasoningHtml = buildReasoningDetailsMarkdown({
		content: 'x',
		extension: { reasoning_content: '用户说电脑卡。' },
	})
	assertStringIncludes(reasoningHtml, '</details>\n\n')
	assertEquals(reasoningHtml.endsWith('\n\n'), true)
})

Deno.test('reasoning block + body via string addition renders markdown bold (trusted)', async () => {
	const reasoningHtml = buildReasoningDetailsMarkdown({
		content: 'x',
		extension: { reasoning_content: '用户说电脑卡。' },
	})
	const joined = reasoningHtml + '你好，**fount前端**卡??'
	assertStringIncludes(joined, '</details>\n\n')
	const html = await render(joined, true)
	assertStringIncludes(html, '<strong>fount前端</strong>')
	assertEquals(html.includes('**fount前端**'), false)
	assertStringIncludes(html, '<details')
})

Deno.test('reasoning block + body via string addition renders markdown bold (untrusted), details stripped', async () => {
	const reasoningHtml = buildReasoningDetailsMarkdown({
		content: 'x',
		extension: { reasoning_content: '用户说电脑卡。' },
	})
	const joined = reasoningHtml + '你好，**fount前端**卡??'
	const html = await render(joined, false)
	assertStringIncludes(html, '<strong>fount前端</strong>')
	assertEquals(html.includes('**fount前端**'), false)
	assertEquals(html.includes('<details'), false)
})

Deno.test('no-blank-line join keeps raw asterisks (the bug blank line fixes)', async () => {
	// `</details>` 后无空行时，正文被吞进 raw HTML 块
	const buggy = '<details class="fount-reasoning-details collapse"><summary>推理</summary></details>\n你好，**fount前端**卡??'
	const html = await render(buggy, true)
	assertStringIncludes(html, '**fount前端**')
})
