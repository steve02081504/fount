/**
 * 默认包收藏收敛 / 链接键纯函数。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std/assert/mod.ts'

import {
	applyDefaultPackConverge,
	entityDefaultLinkKey,
	groupDefaultLinkKey,
	resolveGroupDefaultPackId,
} from '../../src/emojiCollectionLogic.mjs'

Deno.test('resolveGroupDefaultPackId prefers explicit then groupId', () => {
	assertEquals(resolveGroupDefaultPackId({ defaultEmojiPackId: 'pack_a' }, 'g1'), 'pack_a')
	assertEquals(resolveGroupDefaultPackId({}, 'g1'), 'g1')
	assertEquals(resolveGroupDefaultPackId(null, 'g1'), 'g1')
})

Deno.test('link keys', () => {
	assertEquals(groupDefaultLinkKey('g1'), 'group:g1')
	assertEquals(entityDefaultLinkKey('AbC'), 'entity:abc')
})

Deno.test('applyDefaultPackConverge first link adds', () => {
	assertEquals(applyDefaultPackConverge([], null, 'p1'), ['p1'])
	assertEquals(applyDefaultPackConverge(['x'], '', 'p1'), ['x', 'p1'])
})

Deno.test('applyDefaultPackConverge replaces when old in collection', () => {
	assertEquals(applyDefaultPackConverge(['a', 'p1', 'b'], 'p1', 'p2'), ['a', 'p2', 'b'])
	assertEquals(applyDefaultPackConverge(['p1', 'p2'], 'p1', 'p2'), ['p2'])
})

Deno.test('applyDefaultPackConverge respects manual remove', () => {
	assertEquals(applyDefaultPackConverge(['other'], 'p1', 'p2'), ['other'])
})
