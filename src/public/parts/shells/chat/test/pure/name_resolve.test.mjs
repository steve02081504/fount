/**
 * 具名层名字解析与消歧纯函数测试。
 */
/* global Deno */
import { disambiguateLabels, resolveDisplayName } from 'fount/public/parts/shells/chat/public/shared/nameResolve.mjs'
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'


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

Deno.test('hydrateAuthorLabels 路径：alias 压过 profile.name，禁止裸写 profile', () => {
	// 模拟 presence.hydrateAuthorLabels 入参：当前 DOM 文案作 fallback，profile 异步补齐
	const currentDom = 'member-display'
	assertEquals(
		resolveDisplayName({
			entityHash: HASH,
			alias: '宠物名',
			profileName: 'ProfileName',
			fallbackLabel: currentDom,
		}),
		'宠物名',
	)
	assertEquals(
		resolveDisplayName({
			entityHash: HASH,
			alias: '',
			profileName: 'ProfileName',
			fallbackLabel: currentDom,
		}),
		'ProfileName',
	)
	assertEquals(
		resolveDisplayName({
			entityHash: HASH,
			alias: '',
			profileName: '',
			fallbackLabel: currentDom,
		}),
		'member-display',
	)
})

Deno.test('authorDisplayLabel 路径：有 entityHash 时 alias → member fallback → 短码', () => {
	assertEquals(
		resolveDisplayName({
			entityHash: HASH,
			alias: '别名',
			fallbackLabel: '成员名',
		}),
		'别名',
	)
	assertEquals(
		resolveDisplayName({
			entityHash: HASH,
			alias: '',
			fallbackLabel: '成员名',
		}),
		'成员名',
	)
	assertEquals(
		resolveDisplayName({
			entityHash: HASH,
			alias: '',
			fallbackLabel: undefined,
		}),
		'aaaaaaaa…aaaa',
	)
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

Deno.test('成员列表消歧：同名两人 → 名·xxxx', () => {
	const hashA = '0'.repeat(64) + 'deadbeef' + '0'.repeat(56)
	const hashB = '0'.repeat(64) + 'cafebabe' + '0'.repeat(56)
	assertEquals(hashA.slice(64, 68), 'dead')
	assertEquals(hashB.slice(64, 68), 'cafe')
	assertEquals(
		disambiguateLabels([
			{ label: '同名', entityHash: hashA },
			{ label: '同名', entityHash: hashB },
		]),
		['同名·dead', '同名·cafe'],
	)
})
