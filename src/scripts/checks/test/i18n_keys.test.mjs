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
	nestAllPrefixClustersWithMap,
	scanI18nKeyStructure,
} from '../i18n_keys.mjs'

Deno.test('camelPrefixes / decapitalize / findPrefixClusters', () => {
	assertEquals(camelPrefixes('channelPermsHint'), ['channel', 'channelPerms'])
	assertEquals(decapitalize('Hint'), 'hint')
	assertEquals(camelPrefixes('SEND_MESSAGES'), [])
	assertEquals(decapitalize('SEND_MESSAGES'), 'SEND_MESSAGES')
	const clusters = findPrefixClusters([
		'channelPermsHint',
		'channelPermsSelectChannel',
		'channelPermsAddRole',
		'channelPermsRemoveRole',
		'other',
	])
	assertEquals(clusters[0]?.prefix, 'channelPerms')
	assertEquals(clusters[0]?.members.length, 4)
	assertEquals(findPrefixClusters([
		'SEND_MESSAGES',
		'VIEW_CHANNEL',
		'MANAGE_CHANNELS',
		'MANAGE_ROLES',
		'MANAGE_FILES',
		'MANAGE_MESSAGES',
	]), [])
})

Deno.test('nestAllPrefixClusters preserves SCREAMING_SNAKE remainders under perm', async () => {
	const obj = {
		permSEND_MESSAGES: '发消息',
		permVIEW_CHANNEL: '查看',
		permADD_REACTIONS: '反应',
		permUPLOAD_FILES: '上传',
		permMANAGE_CHANNELS: '管频道',
	}
	nestAllPrefixClusters(obj)
	assertEquals(obj.perm, {
		SEND_MESSAGES: '发消息',
		VIEW_CHANNEL: '查看',
		ADD_REACTIONS: '反应',
		UPLOAD_FILES: '上传',
		MANAGE_CHANNELS: '管频道',
	})
	assertEquals(scanI18nKeyStructure(obj), [])

	const { readdir } = await import('node:fs/promises')
	const localesDir = join(REPO_ROOT, 'src/public/locales')
	const localeFiles = (await readdir(localesDir)).filter(name => name.endsWith('.json'))
	assert(localeFiles.length > 0, 'expected locale JSON files')
	for (const fileName of localeFiles) {
		const data = JSON.parse(await readFile(join(localesDir, fileName), 'utf8'))
		const perm = data?.chat?.group?.settings?.page?.perm
		assert(perm && typeof perm === 'object', `${fileName}: missing chat.group.settings.page.perm`)
		assert(Object.hasOwn(perm, 'SEND_MESSAGES'), `${fileName}: missing perm.SEND_MESSAGES`)
		assert(Object.hasOwn(perm, 'MANAGE_CHANNELS'), `${fileName}: missing perm.MANAGE_CHANNELS`)
		assert(!Object.hasOwn(perm, 'mANAGE_'), `${fileName}: bad key mANAGE_`)
		assert(!Object.keys(perm).some(key => /^[a-z][A-Z0-9_]*$/.test(key) && key.includes('_')),
			`${fileName}: unexpected mangled SCREAMING_SNAKE remainder under perm`)
		assertEquals(scanI18nKeyStructure({ perm }), [], `${fileName}: perm structure issues`)
	}
})

Deno.test('Python reshape_i18n_keys preserves SCREAMING_SNAKE remainders', async () => {
	const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
	const { tmpdir } = await import('node:os')
	const dir = await mkdtemp(join(tmpdir(), 'reshape-i18n-'))
	const scriptPath = join(dir, 'reshape_smoke.py')
	const commandsDir = join(REPO_ROOT, '.esh', 'commands')
	await writeFile(scriptPath, `\
import json, sys
sys.path.insert(0, ${JSON.stringify(commandsDir)})
from reshape_i18n_keys import nest_all_prefix_clusters_with_map, dumps_locale, loads_locale

obj = loads_locale(json.dumps({
	"permSEND_MESSAGES": "send",
	"permVIEW_CHANNEL": "view",
	"permADD_REACTIONS": "react",
	"permUPLOAD_FILES": "upload",
	"permMANAGE_CHANNELS": "channels",
}, ensure_ascii=False))
nest_all_prefix_clusters_with_map(obj)
assert "perm" in obj
keys = list(obj["perm"].keys())
assert set(keys) == {"SEND_MESSAGES", "VIEW_CHANNEL", "ADD_REACTIONS", "UPLOAD_FILES", "MANAGE_CHANNELS"}, keys
assert "sEND_MESSAGES" not in obj["perm"]
assert "mANAGE_CHANNELS" not in obj["perm"]
rewritten = loads_locale(dumps_locale(obj))
assert rewritten["perm"]["SEND_MESSAGES"] == "send"
print(json.dumps({"ok": True, "perm": sorted(rewritten["perm"].keys())}))
`, 'utf8')
	try {
		const command = new Deno.Command('python', {
			args: [scriptPath],
			cwd: REPO_ROOT,
			stdout: 'piped',
			stderr: 'piped',
		})
		const { code, stdout, stderr } = await command.output()
		const out = new TextDecoder().decode(stdout).trim()
		const err = new TextDecoder().decode(stderr).trim()
		assertEquals(code, 0, err || out || 'python reshape failed')
		const result = JSON.parse(out)
		assertEquals(result.ok, true)
		assertEquals(result.perm, [
			'ADD_REACTIONS', 'MANAGE_CHANNELS', 'SEND_MESSAGES', 'UPLOAD_FILES', 'VIEW_CHANNEL',
		])
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
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
		404: { title: 'ok' },
	})
	assert(issues.some(keyIssue => keyIssue.kind === 'affix' && keyIssue.path.includes('packGroupSuffix')))
	assert(issues.some(keyIssue => keyIssue.kind === 'affix' && keyIssue.message.includes(AFFIX_HINT)))
	assert(issues.some(keyIssue => keyIssue.kind === 'numbered' && keyIssue.path.includes('item1')))
	assert(issues.some(keyIssue => keyIssue.kind === 'prefix_cluster' && keyIssue.message.includes('tabs:')))
	assert(issues.every(keyIssue => keyIssue.message.includes(UPDATE_LOCALE_DATA_HINT)))
	assert(!issues.some(keyIssue => keyIssue.path === '404' || keyIssue.path.startsWith('404.')))
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

Deno.test('nestAllPrefixClustersWithMap records old→new paths', () => {
	const removing = {
		removingFount: 'base',
		removingFountInstallationDir: 'dir',
		removingFountFromPath: 'path',
		removingFountFromGitSafeDir: 'git',
		removingFountPwshFromProfile: 'pwsh',
	}
	/** @type {Map<string, string>} */
	const removingMap = new Map()
	nestAllPrefixClustersWithMap(removing, '', removingMap)
	assertEquals(removingMap.get('removingFount'), 'removingFount.main')
	assertEquals(removingMap.get('removingFountInstallationDir'), 'removingFount.installationDir')
	assertEquals(removing.removingFount.main, 'base')

	const status = {
		status: { online: '在线', dnd: '勿扰' },
		statusOnline: { title: '在线' },
		statusIdle: { title: '离开' },
		statusDnd: { title: '勿扰' },
		statusOffline: { title: '离线' },
	}
	/** @type {Map<string, string>} */
	const statusMap = new Map()
	nestAllPrefixClustersWithMap(status, '', statusMap)
	assertEquals(statusMap.get('statusOnline'), 'statusItems.online')
	assertEquals(status.statusItems.online, { title: '在线' })
	assertEquals(scanI18nKeyStructure(status), [])

	const nested = {
		parent: {
			tabMembers: 'm',
			tabAudit: 'a',
			tabEmojis: 'e',
			tabAdvanced: 'v',
		},
	}
	/** @type {Map<string, string>} */
	const nestedMap = new Map()
	nestAllPrefixClustersWithMap(nested, '', nestedMap)
	assertEquals(nestedMap.get('parent.tabMembers'), 'parent.tabs.members')
	assertEquals(nested.parent.tabs.members, 'm')
	assertEquals(scanI18nKeyStructure(nested), [])
})

Deno.test('zh-CN.json passes i18n key structure rules', async () => {
	const data = JSON.parse(await readFile(join(REPO_ROOT, 'src/public/locales/zh-CN.json'), 'utf8'))
	const issues = scanI18nKeyStructure(data)
	assertEquals(
		issues.map(keyIssue => `[${keyIssue.kind}] ${keyIssue.path}: ${keyIssue.message}`),
		[],
		issues.map(keyIssue => `[${keyIssue.kind}] ${keyIssue.path}: ${keyIssue.message}`).join('\n'),
	)
})
