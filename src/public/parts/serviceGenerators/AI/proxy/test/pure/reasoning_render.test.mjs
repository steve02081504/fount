/**
 * reasoning `<details>` 块拼接约定（Deno 纯）：buildReasoningDetailsMarkdown 产物
 * 必须以 `</details>\n\n` 结尾（CommonMark raw HTML 块直到空行才结束，末尾空行让
 * 后续正文继续走 Markdown 渲染）。渲染侧行为由 shells/chat 的前端
 * reasoningRender.spec.mjs 在真实浏览器里钉住。
 */
/* global Deno */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { buildReasoningDetailsMarkdown } from '../../src/reasoningRenderer.mjs'

Deno.test('buildReasoningDetailsMarkdown output ends with blank line (two newlines)', () => {
	const reasoningHtml = buildReasoningDetailsMarkdown({
		content: 'x',
		extension: { reasoning_content: '用户说电脑卡。' },
	})
	assertStringIncludes(reasoningHtml, '</details>\n\n')
	assertEquals(reasoningHtml.endsWith('\n\n'), true)
})

Deno.test('buildReasoningDetailsMarkdown empty reasoning yields empty string', () => {
	assertEquals(buildReasoningDetailsMarkdown({ content: 'x', extension: {} }), '')
})

Deno.test('buildReasoningDetailsMarkdown emits no indented raw-HTML lines (renderer-agnostic)', () => {
	for (const open of [false, true]) {
		const reasoningHtml = buildReasoningDetailsMarkdown({
			content: 'x',
			extension: { reasoning_content: 'think step', reasoning_summary: ['summary line'] },
		}, { open })
		assertEquals(reasoningHtml.includes('\t'), false)
		for (const line of reasoningHtml.split('\n'))
			assertEquals(/^ {4,}/.test(line), false, `line starts with 4+ spaces: ${JSON.stringify(line)}`)
		assertStringIncludes(reasoningHtml, '</details>\n\n')
		assertEquals(reasoningHtml.endsWith('</details>\n\n'), true)
	}
})
