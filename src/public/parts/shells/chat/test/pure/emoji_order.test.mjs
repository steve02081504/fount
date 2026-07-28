/**
 * emoji order / presentation 纯函数用例。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std/assert/mod.ts'

import {
	countUsageInWindow,
	orderPackSections,
	packCountsFromLog,
	packEmojiUsageId,
	recentEmojisFromLog,
	trimUsageLog,
	unicodeUsageId,
} from '../../../../../pages/scripts/features/emoji/order.mjs'
import {
	resolveEmojiItemLabels,
	resolvePackPresentation,
} from '../../../../../pages/scripts/features/emoji/packPresentation.mjs'
import { buildEmojiAliasIndex } from '../../public/shared/inlineTokenSyntax.mjs'

Deno.test('trimUsageLog keeps last N', () => {
	const log = Array.from({ length: 5 }, (_, i) => ({ id: `u:${i}`, at: i }))
	assertEquals(trimUsageLog(log, 3).map(e => e.id), ['u:2', 'u:3', 'u:4'])
})

Deno.test('recentEmojisFromLog sorts by count', () => {
	const log = [
		{ id: unicodeUsageId('😀') },
		{ id: unicodeUsageId('🎉') },
		{ id: unicodeUsageId('😀') },
		{ id: packEmojiUsageId('p1', 'a') },
		{ id: packEmojiUsageId('p1', 'a') },
		{ id: packEmojiUsageId('p1', 'a') },
	]
	const recent = recentEmojisFromLog(log)
	assertEquals(recent[0].parsed.emojiId, 'a')
	assertEquals(recent[0].count, 3)
	assertEquals(countUsageInWindow(log).get(unicodeUsageId('😀')), 2)
	assertEquals(packCountsFromLog(log).get('p1'), 3)
})

Deno.test('orderPackSections five-tier pack order', () => {
	const packs = [
		{ packId: 'ctx', joinedAt: 1 },
		{ packId: 'used', joinedAt: 2 },
		{ packId: 'old', joinedAt: 10 },
		{ packId: 'fresh', joinedAt: 99 },
	]
	const log = [
		{ id: packEmojiUsageId('used', 'x') },
		{ id: packEmojiUsageId('used', 'y') },
	]
	const ordered = orderPackSections({
		packs,
		contextDefaultPackIds: ['ctx'],
		log,
		lastUsedAtByPack: { old: 50 },
	})
	assertEquals(ordered.map(o => o.packId), ['ctx', 'used', 'old', 'fresh'])
	assertEquals(ordered.map(o => o.tier), [2, 3, 4, 4])
})

Deno.test('packPresentation locale fallback', () => {
	const pack = {
		packId: 'p',
		localized: {
			'zh-CN': { name: '中文包', avatar: 'a.png' },
			'en-UK': { name: 'EN pack' },
		},
	}
	assertEquals(resolvePackPresentation(pack, ['zh-CN']).name, '中文包')
	assertEquals(resolvePackPresentation(pack, ['fr'], { name: '默认' }).name, '中文包')
	assertEquals(resolvePackPresentation({ packId: 'x', localized: {} }, ['zh'], { name: '群名' }).name, '群名')
})

Deno.test('emoji item name/alt fallback', () => {
	const item = {
		emojiId: 'cat',
		localized: {
			'zh-CN': { name: '猫', alt: '猫咪' },
			'en-UK': { name: 'cat' },
		},
	}
	assertEquals(resolveEmojiItemLabels(item, ['zh-CN']), { name: '猫', alt: '猫咪' })
	assertEquals(resolveEmojiItemLabels(item, ['en-UK']), { name: 'cat', alt: 'cat' })
	assertEquals(resolveEmojiItemLabels({ emojiId: 'x', localized: {} }, ['zh']), { name: 'x', alt: 'x' })
})

Deno.test('alias index cross-locale first wins', () => {
	const index = buildEmojiAliasIndex([
		{ emojiId: 'a', localized: { 'zh-CN': { name: '同名' }, 'en-UK': { alt: 'same' } } },
		{ emojiId: 'b', localized: { 'zh-CN': { name: '同名', alt: 'same' } } },
	])
	assertEquals(index.get('同名'), 'a')
	assertEquals(index.get('same'), 'a')
	assertEquals(index.get('a'), 'a')
})

Deno.test('rewriteEmojiAliasesInText rewrites unicode aliases', async () => {
	const { formatEmojiToken, rewriteEmojiAliasesInText, resolveEmojiIdFromAlias } = await import(
		'../../public/shared/inlineTokenSyntax.mjs'
	)
	const index = buildEmojiAliasIndex([
		{ emojiId: 'emoji_1', localized: { 'zh-CN': { name: '猫', alt: '猫咪' } } },
	])
	const raw = `hi ${formatEmojiToken('pack_a', '猫咪')} ${formatEmojiToken('pack_a', 'emoji_1')}`
	const out = rewriteEmojiAliasesInText(raw, (packId, id) => {
		if (packId !== 'pack_a') return id
		return resolveEmojiIdFromAlias(index, id) || id
	})
	assertEquals(out.includes(formatEmojiToken('pack_a', 'emoji_1')), true)
	assertEquals(out.includes('猫咪'), false)
})
