/**
 * reasoningRenderer：content_for_show 走 Markdown，正文不 HTML 转义。
 */
/* global Deno */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { buildReasoningDetailsMarkdown } from '../../../../serviceGenerators/AI/proxy/src/reasoningRenderer.mjs'

Deno.test('buildReasoningDetailsMarkdown keeps code-fence angle brackets raw', () => {
	const markdown = buildReasoningDetailsMarkdown({
		content: 'hi',
		extension: {
			reasoning_content: 'Use `Array<T>` or:\n\n```ts\nconst x: Array<number> = []\n```',
		},
	})
	assertStringIncludes(markdown, '<details class="fount-reasoning-details collapse collapse-arrow my-2 mb-3 rounded-lg border border-base-content/20 bg-base-200/30">')
	assertStringIncludes(markdown, '</details>')
	assertStringIncludes(markdown, 'Array<T>')
	assertStringIncludes(markdown, 'Array<number>')
	assertEquals(markdown.includes('&lt;'), false)
	assertEquals(markdown.includes('&gt;'), false)
})

Deno.test('buildReasoningDetailsMarkdown separates HTML block from body with blank lines', () => {
	const markdown = buildReasoningDetailsMarkdown({
		content: '',
		extension: { reasoning_content: 'step one' },
	}, { open: true })
	const lines = markdown.split('\n')
	assertEquals(lines[0], '<details class="fount-reasoning-details collapse collapse-arrow my-2 mb-3 rounded-lg border border-base-content/20 bg-base-200/30" open>')
	assertEquals(lines[1], '')
	assertStringIncludes(lines[2], '<summary class="fount-reasoning-summary collapse-title')
	assertEquals(lines[3], '')
	assertEquals(lines[4].trim(), '<div class="collapse-content">')
	assertEquals(lines[5], '')
	assertEquals(lines[6].trim(), 'step one')
	assertEquals(lines[7], '')
	assertEquals(lines[8].trim(), '</div>')
	assertEquals(lines[9], '')
	assertEquals(lines[10], '</details>')
})

Deno.test('buildReasoningDetailsMarkdown joins summary items with blank lines', () => {
	const markdown = buildReasoningDetailsMarkdown({
		content: '',
		extension: { reasoning_summary: ['alpha', 'beta <gamma>'] },
	})
	assertStringIncludes(markdown, 'alpha\n\nbeta <gamma>')
	assertEquals(markdown.includes('&lt;gamma&gt;'), false)
})

Deno.test('buildReasoningDetailsMarkdown returns empty when no reasoning', () => {
	assertEquals(buildReasoningDetailsMarkdown({ content: 'x', extension: {} }), '')
})
