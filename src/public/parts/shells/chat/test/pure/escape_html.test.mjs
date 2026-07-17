/**
 * 共享 escapeHtml：属性安全（含引号）回归。
 */
/* global Deno */
import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { escapeHtml } from '../../../../../pages/scripts/lib/escapeHtml.mjs'

Deno.test('escapeHtml escapes quotes so attribute values stay intact', () => {
	const raw = '<details class="fount-reasoning-details"><summary>推理</summary></details>'
	const escaped = escapeHtml(raw)
	assertStringIncludes(escaped, '&lt;details')
	assertStringIncludes(escaped, 'class=&quot;fount-reasoning-details&quot;')
	assertEquals(escaped.includes('"'), false)
	assertEquals(escaped.includes('<'), false)
	assertEquals(escaped.includes('>'), false)
})

Deno.test('escapeHtml escapes ampersand and apostrophe', () => {
	assertEquals(escapeHtml('a&b\'c'), 'a&amp;b&#39;c')
})
