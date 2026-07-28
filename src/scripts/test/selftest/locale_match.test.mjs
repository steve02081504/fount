/**
 * locale_match 前后端同构钉死：同一份用例表跑两份实现。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std/assert/mod.ts'

import * as frontend from '../../../public/pages/scripts/i18n/locale_match.mjs'
import * as backend from '../../i18n/locale_match.mjs'

const impls = [
	{ name: 'backend', mod: backend },
	{ name: 'frontend', mod: frontend },
]

const cases = [
	{
		name: 'exact_hit',
		preferred: ['zh-CN', 'en-UK'],
		available: ['en-UK', 'zh-CN', 'ja-JP'],
		match: 'zh-CN',
		best: 'zh-CN',
	},
	{
		name: 'prefix_fallback',
		preferred: ['zh'],
		available: ['zh-CN', 'en-UK'],
		match: 'zh-CN',
		best: 'zh-CN',
	},
	{
		name: 'strict_prefix_no_false_hit',
		preferred: ['zh'],
		available: ['zhuang', 'en-UK'],
		match: undefined,
		best: 'en-UK',
	},
	{
		name: 'object_id_shape',
		preferred: ['ja-JP'],
		available: [{ id: 'en-UK' }, { id: 'ja-JP' }],
		match: 'ja-JP',
		best: 'ja-JP',
	},
	{
		name: 'empty_available_fallback',
		preferred: ['zh-CN'],
		available: [],
		match: undefined,
		best: 'en-UK',
	},
]

for (const { name, mod } of impls)
	Deno.test(`locale_match:${name}`, () => {
		assertEquals(mod.FALLBACK_LOCALE, 'en-UK')
		for (const c of cases) {
			assertEquals(mod.matchLocale(c.preferred, c.available), c.match, `${c.name}.match`)
			assertEquals(mod.getBestLocale(c.preferred, c.available), c.best, `${c.name}.best`)
		}

		const map = { 'zh-CN': { name: '中' }, 'en-UK': { name: 'En' }, zhuang: { name: 'wrong' } }
		assertEquals(mod.pickLocalizedSlice(map, ['zh'])?.name, '中')
		assertEquals(mod.pickLocalizedSlice(map, ['fr'])?.name, '中') // 首键
		assertEquals(mod.pickLocalizedSlice({}, ['zh']), undefined)
		assertEquals(mod.pickLocalizedSlice(undefined, ['zh']), undefined)
	})
