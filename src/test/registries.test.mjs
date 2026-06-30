/**
 * 泛型 registries 聚合单元测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	dedupeAndSortRegistryEntries,
	partpathToUrlPrefix,
	resolveRegistryPathToUrl,
} from '../server/registries.mjs'

Deno.test('partpathToUrlPrefix maps shells/chat', () => {
	assertEquals(partpathToUrlPrefix('shells/chat'), '/parts/shells:chat')
})

Deno.test('resolveRegistryPathToUrl joins part-relative path', () => {
	assertEquals(
		resolveRegistryPathToUrl('shells/chat', 'markdown_ext/index.mjs'),
		'/parts/shells:chat/markdown_ext/index.mjs',
	)
})

Deno.test('dedupeAndSortRegistryEntries keeps later id and sorts by level', () => {
	const sorted = dedupeAndSortRegistryEntries([
		{ id: 'chatEmoji', level: 2, path: 'old.mjs', partpath: 'shells/chat' },
		{ id: 'other', level: 0, path: 'other.mjs', partpath: 'shells/social' },
		{ id: 'chatEmoji', level: 1, path: 'providers/emoji.mjs', partpath: 'shells/chat' },
	])
	assertEquals(sorted.length, 2)
	assertEquals(sorted[0].id, 'other')
	assertEquals(sorted[1].path, 'providers/emoji.mjs')
})

Deno.test('dedupeAndSortRegistryEntries keeps same id from different parts', () => {
	const sorted = dedupeAndSortRegistryEntries([
		{ id: 'function_buttons', level: 0, path: 'home_registry.json', partpath: 'shells/chat' },
		{ id: 'function_buttons', level: 0, path: 'home_registry.json', partpath: 'shells/access' },
	])
	assertEquals(sorted.length, 2)
})
