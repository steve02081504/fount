/**
 * reasoningRenderer：content_for_show 走 Markdown，正文不 HTML 转义。
 */
/* global Deno */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { buildReasoningDetailsMarkdown } from '../../../../serviceGenerators/AI/proxy/src/reasoningRenderer.mjs'

Deno.test('buildReasoningDetailsMarkdown keeps code-fence angle brackets raw', () => {
	const md = buildReasoningDetailsMarkdown({
		content: 'hi',
		extension: {
			reasoning_content: 'Use `Array<T>` or:\n\n```ts\nconst x: Array<number> = []\n```',
		},
	})
	assertStringIncludes(md, '<details class="fount-reasoning-details collapse collapse-arrow my-2 mb-3 rounded-lg border border-base-content/20 bg-base-200/60">')
	assertStringIncludes(md, '</details>')
	assertStringIncludes(md, 'Array<T>')
	assertStringIncludes(md, 'Array<number>')
	assertEquals(md.includes('&lt;'), false)
	assertEquals(md.includes('&gt;'), false)
})

Deno.test('buildReasoningDetailsMarkdown separates HTML block from body with blank lines', () => {
	const md = buildReasoningDetailsMarkdown({
		content: '',
		extension: { reasoning_content: 'step one' },
	}, { open: true })
	const lines = md.split('\n')
	assertEquals(lines[0], '<details class="fount-reasoning-details collapse collapse-arrow my-2 mb-3 rounded-lg border border-base-content/20 bg-base-200/60" open>')
	assertEquals(lines[1], '')
	assertStringIncludes(lines[2], '<summary class="collapse-title')
	assertEquals(lines[3], '')
	assertEquals(lines[4], '<div class="collapse-content">')
	assertEquals(lines[5], '')
	assertEquals(lines[6], 'step one')
	assertEquals(lines[7], '')
	assertEquals(lines[8], '</div>')
	assertEquals(lines[9], '')
	assertEquals(lines[10], '</details>')
})

Deno.test('buildReasoningDetailsMarkdown joins summary items with blank lines', () => {
	const md = buildReasoningDetailsMarkdown({
		content: '',
		extension: { reasoning_summary: ['alpha', 'beta <gamma>'] },
	})
	assertStringIncludes(md, 'alpha\n\nbeta <gamma>')
	assertEquals(md.includes('&lt;gamma&gt;'), false)
})

Deno.test('buildReasoningDetailsMarkdown returns empty when no reasoning', () => {
	assertEquals(buildReasoningDetailsMarkdown({ content: 'x', extension: {} }), '')
})
