/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import {
	ensureLocaleEntry,
	renameLocaleEntry,
} from 'fount/public/parts/shells/chat/public/shared/profileLocaleState.mjs'
import { profileBannerFileUrl } from 'fount/public/parts/shells/chat/src/entity/filesUrl.mjs'
import {
	normalizeLocalizedMap,
	resolveProfilePresentation,
} from 'fount/public/parts/shells/chat/src/entity/localized.mjs'


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

Deno.test('normalizeLocalizedMap keeps sfw_* display fields', () => {
	const localized = normalizeLocalizedMap({
		'zh-CN': {
			name: '日常',
			avatar: '🔥',
			sfw_name: '安全名',
			sfw_avatar: '🙂',
			sfw_tags: ['#安全'],
			sfw_links: [{ name: 'Home', url: 'https://example.test' }],
		},
	})
	assertEquals(localized['zh-CN'].sfw_name, '安全名')
	assertEquals(localized['zh-CN'].sfw_avatar, '🙂')
	assertEquals(localized['zh-CN'].sfw_tags, ['安全'])
	assertEquals(localized['zh-CN'].sfw_links, [{ icon: '', name: 'Home', url: 'https://example.test' }])
})

Deno.test('resolveProfilePresentation overlays sfw_* when sfw true', () => {
	const hash = 'a'.repeat(128)
	const stored = {
		entityHash: hash,
		subjectHash: 'b'.repeat(64),
		banner: 'https://example.test/nsfw-banner.png',
		sfw_banner: 'https://example.test/sfw-banner.png',
		localized: {
			'zh-CN': {
				name: '日常名',
				avatar: '🔥',
				description: 'nsfw bio',
				description_markdown: 'nsfw **bio**',
				tags: ['nsfw'],
				sfw_name: '安全名',
				sfw_avatar: '🙂',
				sfw_description: 'sfw bio',
				sfw_description_markdown: 'sfw **bio**',
				sfw_tags: ['safe'],
			},
		},
	}
	const defaults = {
		name: '默认名', tags: [], links: [], description: '', description_markdown: '',
		avatar: '', version: '', author: '', home_page: '', issue_page: '',
	}
	const off = resolveProfilePresentation(stored, ['zh-CN'], defaults, { sfw: false })
	assertEquals(off.name, '日常名')
	assertEquals(off.avatar, '🔥')
	assertEquals(off.description_markdown, 'nsfw **bio**')
	assertEquals(off.tags, ['nsfw'])
	assertEquals(off.banner, 'https://example.test/nsfw-banner.png')

	const on = resolveProfilePresentation(stored, ['zh-CN'], defaults, { sfw: true })
	assertEquals(on.name, '安全名')
	assertEquals(on.avatar, '🙂')
	assertEquals(on.description_markdown, 'sfw **bio**')
	assertEquals(on.tags, ['safe'])
	assertEquals(on.banner, 'https://example.test/sfw-banner.png')
})

Deno.test('resolveProfilePresentation sfw falls back to baseline when sfw_* absent', () => {
	const resolved = resolveProfilePresentation(
		{
			entityHash: 'a'.repeat(128),
			subjectHash: 'b'.repeat(64),
			banner: 'https://example.test/b.png',
			localized: { 'zh-CN': { name: '仅基线', avatar: '🟢' } },
		},
		['zh-CN'],
		{ name: '默认名', tags: ['助手'], links: [], description: '', description_markdown: '', avatar: '', version: '', author: '', home_page: '', issue_page: '' },
		{ sfw: true },
	)
	assertEquals(resolved.name, '仅基线')
	assertEquals(resolved.avatar, '🟢')
	assertEquals(resolved.banner, 'https://example.test/b.png')
})

Deno.test('resolveProfilePresentation rewrites sfw logical avatar path', () => {
	const hash = 'a'.repeat(128)
	const resolved = resolveProfilePresentation(
		{
			entityHash: hash,
			subjectHash: 'b'.repeat(64),
			localized: { 'zh-CN': { name: '用户', sfw_avatar: 'profile/sfw_avatar' } },
		},
		['zh-CN'],
		{ name: '默认名', tags: [], links: [], description: '', description_markdown: '', avatar: '', version: '', author: '', home_page: '', issue_page: '' },
		{ sfw: true },
	)
	assertEquals(resolved.avatar, `/api/parts/shells:chat/entities/${hash}/files/profile/sfw_avatar`)
})
