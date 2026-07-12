/**
 * M3：具名层名字解析与消歧纯函数测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { disambiguateLabels, resolveDisplayName } from 'fount/public/parts/shells/chat/public/shared/nameResolve.mjs'

const HASH = 'a'.repeat(128)

Deno.test('resolveDisplayName 优先级：alias → profile → fallback → 短码', () => {
	assertEquals(resolveDisplayName({ entityHash: HASH, alias: '老王', profileName: 'Wang', fallbackLabel: 'fb' }), '老王')
	assertEquals(resolveDisplayName({ entityHash: HASH, profileName: 'Wang', fallbackLabel: 'fb' }), 'Wang')
	assertEquals(resolveDisplayName({ entityHash: HASH, fallbackLabel: 'fb' }), 'fb')
	assertEquals(resolveDisplayName({ entityHash: HASH }), 'aaaaaaaa…aaaa')
	assertEquals(resolveDisplayName({}), '?')
})

Deno.test('resolveDisplayName 忽略空白别名/资料名', () => {
	assertEquals(resolveDisplayName({ entityHash: HASH, alias: '   ', profileName: 'Wang' }), 'Wang')
})

Deno.test('disambiguateLabels：唯一 label 原样，冲突加 ·slice(64,68) 后缀', () => {
	const hashA = 'a'.repeat(64) + 'b'.repeat(64)
	const hashB = 'a'.repeat(64) + 'c'.repeat(64)
	const labels = disambiguateLabels([
		{ label: 'Bob', entityHash: hashA },
		{ label: 'Bob', entityHash: hashB },
		{ label: 'Alice', entityHash: HASH },
	])
	assertEquals(labels, ['Bob·bbbb', 'Bob·cccc', 'Alice'])
})
