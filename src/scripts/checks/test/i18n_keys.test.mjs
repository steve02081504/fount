/**
 * i18n 键结构：Suffix/Prefix、同前缀≥4、编号后缀。
 */
/* global Deno */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assertEquals, assert } from 'https://deno.land/std/assert/mod.ts'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	AFFIX_HINT,
	UPDATE_LOCALE_DATA_HINT,
	camelPrefixes,
	decapitalize,
	findPrefixClusters,
	nestAllPrefixClusters,
	scanI18nKeyStructure,
} from '../i18n_keys.mjs'

Deno.test('camelPrefixes / decapitalize / findPrefixClusters', () => {
	assertEquals(camelPrefixes('channelPermsHint'), ['channel', 'channelPerms'])
	assertEquals(decapitalize('Hint'), 'hint')
	const clusters = findPrefixClusters([
		'channelPermsHint',
		'channelPermsSelectChannel',
		'channelPermsAddRole',
		'channelPermsRemoveRole',
		'other',
	])
	assertEquals(clusters[0]?.prefix, 'channelPerms')
	assertEquals(clusters[0]?.members.length, 4)
})

Deno.test('scan catches affix / numbered / prefix_cluster', () => {
	const issues = scanI18nKeyStructure({
		packGroupSuffix: 'x',
		PrefixLabel: 'y',
		item1: 'a',
		item2: 'b',
		tabMembers: 'm',
		tabAudit: 'a',
		tabEmojis: 'e',
		tabAdvanced: 'v',
		'404': { title: 'ok' },
	})
	assert(issues.some(i => i.kind === 'affix' && i.path.includes('packGroupSuffix')))
	assert(issues.some(i => i.kind === 'affix' && i.message.includes(AFFIX_HINT)))
	assert(issues.some(i => i.kind === 'numbered' && i.path.includes('item1')))
	assert(issues.some(i => i.kind === 'prefix_cluster' && i.message.includes('tabs:')))
	assert(issues.every(i => i.message.includes(UPDATE_LOCALE_DATA_HINT)))
	assert(!issues.some(i => i.path === '404' || i.path.startsWith('404.')))
})

Deno.test('nestAllPrefixClusters nests tab* into tabs', () => {
	const obj = {
		tabMembers: 'm',
		tabAudit: 'a',
		tabEmojis: 'e',
		tabAdvanced: 'v',
		keep: true,
	}
	nestAllPrefixClusters(obj)
	assertEquals(obj.tabs, { members: 'm', audit: 'a', emojis: 'e', advanced: 'v' })
	assertEquals(obj.keep, true)
	assertEquals(scanI18nKeyStructure(obj), [])
})

Deno.test('nestAllPrefixClusters folds prefix leaf into main and uses Items on conflict', () => {
	const removing = {
		removingFount: 'base',
		removingFountInstallationDir: 'dir',
		removingFountFromPath: 'path',
		removingFountFromGitSafeDir: 'git',
		removingFountPwshFromProfile: 'pwsh',
	}
	nestAllPrefixClusters(removing)
	assertEquals(removing.removingFount.main, 'base')
	assertEquals(removing.removingFount.installationDir, 'dir')

	const status = {
		status: { online: '在线', dnd: '勿扰' },
		statusOnline: { title: '在线' },
		statusIdle: { title: '离开' },
		statusDnd: { title: '勿扰' },
		statusOffline: { title: '离线' },
	}
	nestAllPrefixClusters(status)
	assertEquals(status.status.online, '在线')
	assertEquals(status.statusItems.online, { title: '在线' })
	assertEquals(scanI18nKeyStructure(status), [])
})

Deno.test('zh-CN.json passes i18n key structure rules', async () => {
	const data = JSON.parse(await readFile(join(REPO_ROOT, 'src/public/locales/zh-CN.json'), 'utf8'))
	const issues = scanI18nKeyStructure(data)
	assertEquals(
		issues.map(i => `[${i.kind}] ${i.path}: ${i.message}`),
		[],
		issues.map(i => `[${i.kind}] ${i.path}: ${i.message}`).join('\n'),
	)
})
