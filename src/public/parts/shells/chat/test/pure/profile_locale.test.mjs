/* global Deno */
import {
	ensureLocaleEntry,
	renameLocaleEntry,
} from 'fount/public/parts/shells/chat/public/src/profileLocaleState.mjs'
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

Deno.test('ensureLocaleEntry copies current profile locale without sharing arrays', () => {
	const source = {
		'zh-CN': {
			name: '测试',
			tags: ['原创'],
			links: [{ name: '主页', url: 'https://example.test' }],
		},
	}
	const localized = ensureLocaleEntry(source, 'en-UK', 'zh-CN')
	assertEquals(localized['en-UK'], source['zh-CN'])
	localized['en-UK'].tags.push('English')
	localized['en-UK'].links[0].name = 'Home'
	assertEquals(source['zh-CN'].tags, ['原创'])
	assertEquals(source['zh-CN'].links[0].name, '主页')
})

Deno.test('renameLocaleEntry changes the locale code and keeps its slice', () => {
	const localized = renameLocaleEntry({
		'zh-CN': { name: '测试' },
		'en-UK': { name: 'Test' },
	}, 'en-UK', 'en-US')
	assertEquals(localized, {
		'zh-CN': { name: '测试' },
		'en-US': { name: 'Test' },
	})
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

Deno.test('resolveProfilePresentation does not invent EVFS avatar when unset', () => {
	const hash = 'a'.repeat(128)
	const resolved = resolveProfilePresentation(
		{
			entityHash: hash,
			subjectHash: 'b'.repeat(64),
			localized: { 'zh-CN': { name: '用户' } },
		},
		['zh-CN'],
		{ name: '默认名', tags: [], links: [], description: '', description_markdown: '', avatar: '', version: '', author: '', home_page: '', issue_page: '' },
	)
	assertEquals(resolved.avatar, '')
})

Deno.test('resolveProfilePresentation rewrites relative avatar to EVFS URL', () => {
	const hash = 'a'.repeat(128)
	const resolved = resolveProfilePresentation(
		{
			entityHash: hash,
			subjectHash: 'b'.repeat(64),
			localized: { 'zh-CN': { name: '用户', avatar: 'profile/avatar' } },
		},
		['zh-CN'],
		{ name: '默认名', tags: [], links: [], description: '', description_markdown: '', avatar: '', version: '', author: '', home_page: '', issue_page: '' },
	)
	assertEquals(resolved.avatar, `/api/parts/shells:chat/entities/${hash}/files/profile/avatar`)
})
