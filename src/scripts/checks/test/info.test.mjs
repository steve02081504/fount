/**
 * parts locales.json / achievements_registry.json info 健康检查。
 */
/* global Deno */
import { assertEquals, assert } from 'https://deno.land/std/assert/mod.ts'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	hasEmojiLocaleWarning,
	localesMissingProvider,
	localesWithInfoProvider,
	scanAchievementsData,
	scanLocalesData,
	scanPartsInfo,
} from '../info.mjs'
import { listRepoFiles } from '../walk.mjs'

Deno.test('hasEmojiLocaleWarning skips author/avatar and detects latin', () => {
	assertEquals(hasEmojiLocaleWarning({
		author: 'steve',
		avatar: 'https://example.com/a.png',
		name: '💬',
		description: '✨',
	}).warn, false)
	assertEquals(hasEmojiLocaleWarning({
		name: 'Chat',
		description: 'hello',
	}), { warn: true, langs: ['英文'] })
})

Deno.test('localesWithInfoProvider / localesMissingProvider', () => {
	assertEquals(localesWithInfoProvider({
		'en-UK': { name: 'x', provider: 'y' },
		emoji: { name: '💬' },
	}), ['en-UK'])
	assertEquals(localesMissingProvider({
		'en-UK': { name: 'x', provider: 'y' },
		'zh-CN': { name: '中' },
	}), ['zh-CN'])
})

Deno.test('scanLocalesData flags info.provider and product_info gaps', () => {
	const { issues, emojiMissingAvatar } = scanLocalesData('x/locales.json', {
		info: {
			'en-UK': { name: 'A', provider: 'leak', avatar: 'https://example.com/a.svg' },
			emoji: { name: '💬', description: '✨' },
		},
		product_info: {
			'en-UK': { name: 'A', provider: 'ok' },
			'zh-CN': { name: '甲' },
		},
	})
	assert(issues.some(i => i.message.includes('info 残留 provider')))
	assert(issues.some(i => i.message.includes('product_info 缺少 provider')))
	assertEquals(emojiMissingAvatar, true)
})

Deno.test('scanAchievementsData collects icon urls', () => {
	const { iconUrls } = scanAchievementsData('a/achievements_registry.json', {
		achievements: {
			first: { icon: 'https://example.com/i.svg', locked_icon: 'https://example.com/l.svg' },
		},
	})
	assertEquals(iconUrls.length, 2)
})

Deno.test('repo parts info health (static + url)', async () => {
	const jsonFiles = await listRepoFiles(REPO_ROOT, ['.json'], { under: 'src/public/parts' })
	const localesPaths = jsonFiles.filter(p => p.endsWith('/locales.json'))
	const achievementPaths = jsonFiles.filter(p => p.endsWith('/achievements_registry.json'))
	assert(localesPaths.length > 0, '未找到 parts locales.json')

	const issues = await scanPartsInfo({ repoRoot: REPO_ROOT, localesPaths, achievementPaths })
	assertEquals(
		issues.map(i => `${i.path}: ${i.message}`),
		[],
		issues.map(i => `${i.path}: ${i.message}`).join('\n'),
	)
})
