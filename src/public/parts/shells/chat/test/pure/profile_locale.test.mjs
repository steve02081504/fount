/* global Deno */
import { profileBannerFileUrl } from 'fount/public/parts/shells/chat/src/entity/filesUrl.mjs'
import {
	normalizeLocalizedMap,
	resolveProfilePresentation,
} from 'fount/public/parts/shells/chat/src/entity/localized.mjs'
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'


Deno.test('profileBannerFileUrl points at EVFS profile/banner', () => {
	const hash = 'a'.repeat(128)
	assertEquals(
		profileBannerFileUrl(hash),
		`/api/parts/shells:chat/entities/${hash}/files/profile/banner`,
	)
})

Deno.test('normalizeLocalizedMap keeps empty tags so clear is not lost', () => {
	const localized = normalizeLocalizedMap({
		'zh-CN': { name: '测试', tags: [], links: [] },
	})
	assertEquals(localized['zh-CN'].tags, [])
	assertEquals(localized['zh-CN'].links, [])
})

Deno.test('normalizeLocalizedMap strips leading hashes on tags', () => {
	const localized = normalizeLocalizedMap({
		'zh-CN': { tags: ['##助手', '#原创', '纯文字'] },
	})
	assertEquals(localized['zh-CN'].tags, ['助手', '原创', '纯文字'])
})

Deno.test('resolveProfilePresentation respects explicit empty tags', () => {
	const resolved = resolveProfilePresentation(
		{
			entityHash: 'a'.repeat(128),
			subjectHash: 'b'.repeat(64),
			localized: { 'zh-CN': { name: '用户', tags: [], links: [] } },
		},
		['zh-CN'],
		{ name: '默认名', tags: ['助手'], links: [{ name: 'Home', url: 'https://example.test' }], description: '', description_markdown: '', avatar: '', version: '', author: '', home_page: '', issue_page: '' },
	)
	assertEquals(resolved.tags, [])
	assertEquals(resolved.links, [])
	assertEquals(resolved.name, '用户')
})

Deno.test('resolveProfilePresentation falls back when tags unset', () => {
	const resolved = resolveProfilePresentation(
		{
			entityHash: 'a'.repeat(128),
			subjectHash: 'b'.repeat(64),
			localized: { 'zh-CN': { name: '用户' } },
		},
		['zh-CN'],
		{ name: '默认名', tags: ['助手'], links: [], description: '', description_markdown: '', avatar: '', version: '', author: '', home_page: '', issue_page: '' },
	)
	assertEquals(resolved.tags, ['助手'])
})

Deno.test('normalizeLocalizedMap keeps structured links', () => {
	const localized = normalizeLocalizedMap({
		'zh-CN': {
			links: [
				{ name: 'GitHub', url: 'https://github.com/x', icon: '' },
				{ name: 'bad', url: '' },
			],
		},
	})
	assertEquals(localized['zh-CN'].links, [
		{ icon: '', name: 'GitHub', url: 'https://github.com/x' },
	])
})
