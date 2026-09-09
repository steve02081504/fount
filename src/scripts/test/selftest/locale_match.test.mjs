/**
 * locale_match 用例表：SSOT 实现在 pages/scripts/i18n（前后端共用），
 * 后端 scripts/i18n 只是再导出 shim，不再有第二份实现需要钉同构。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import * as frontend from '../../../public/pages/scripts/i18n/locale_match.mjs'
import * as backend from '../../i18n/locale_match.mjs'

Deno.test('backend locale_match re-exports the frontend SSOT', () => {
	assertEquals(backend.FALLBACK_LOCALE, frontend.FALLBACK_LOCALE)
	assertEquals(backend.matchLocale, frontend.matchLocale)
	assertEquals(backend.getBestLocale, frontend.getBestLocale)
	assertEquals(backend.pickLocalizedSlice, frontend.pickLocalizedSlice)
})

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

Deno.test('locale_match case table', () => {
	assertEquals(frontend.FALLBACK_LOCALE, 'en-UK')
	for (const c of cases) {
		assertEquals(frontend.matchLocale(c.preferred, c.available), c.match, `${c.name}.match`)
		assertEquals(frontend.getBestLocale(c.preferred, c.available), c.best, `${c.name}.best`)
	}

	const map = { 'zh-CN': { name: '中' }, 'en-UK': { name: 'En' }, zhuang: { name: 'wrong' } }
	assertEquals(frontend.pickLocalizedSlice(map, ['zh'])?.name, '中')
	assertEquals(frontend.pickLocalizedSlice(map, ['fr'])?.name, '中') // 首键
	assertEquals(frontend.pickLocalizedSlice({}, ['zh']), undefined)
	assertEquals(frontend.pickLocalizedSlice(undefined, ['zh']), undefined)
})
