/**
 * i18n 引用解析：data-i18n 对象须含 DOM applicator；字符串 API / CLI 须落到 string。
 */
/* global Deno */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assertEquals, assert } from 'https://deno.land/std/assert/mod.ts'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	checkElementI18nKey,
	checkStringI18nKey,
	extractFountConsolePathKeys,
	extractI18nRefsFromSource,
	isStaticI18nKey,
	scanFountConsolePathScript,
	scanSourceI18nRefs,
} from '../i18n_refs.mjs'
import { I18N_REWRITE_SUFFIXES, listRepoFiles } from '../walk.mjs'

const LEAVE_LIKE = {
	chat: {
		hub: {
			group: {
				context: {
					leave: {
						main: '退出群',
						confirm: '确定？',
						ok: '已退出',
					},
				},
			},
			send: {
				main: '发送',
				title: { title: '发送 (Ctrl+Enter)' },
				failed: '失败：${error}',
			},
		},
	},
	fountConsole: {
		path: {
			remove: {
				removing: {
					fount: {
						main: '正在移除 fount...',
						fromPath: '正在从 PATH 中移除…',
					},
				},
			},
		},
	},
}

Deno.test('isStaticI18nKey rejects template interpolations', () => {
	assertEquals(isStaticI18nKey('chat.hub.group.context.leave'), true)
	assertEquals(isStaticI18nKey('chat.hub.status.${status}'), false)
	assertEquals(isStaticI18nKey('${i18nKey}'), false)
	assertEquals(isStaticI18nKey('key'), false)
})

Deno.test('checkElementI18nKey flags leave-style object without applicator', () => {
	assertEquals(checkElementI18nKey(LEAVE_LIKE, 'chat.hub.group.context.leave')?.kind, 'object_not_element')
	assertEquals(checkElementI18nKey(LEAVE_LIKE, 'chat.hub.group.context.leave.main'), null)
	assertEquals(checkElementI18nKey(LEAVE_LIKE, 'chat.hub.send.title'), null)
	assertEquals(checkElementI18nKey(LEAVE_LIKE, 'chat.hub.send.missing')?.kind, 'missing')
})

Deno.test('checkStringI18nKey flags object parent used as toast/CLI string', () => {
	assertEquals(checkStringI18nKey(LEAVE_LIKE, 'chat.hub.group.context.leave')?.kind, 'object_not_string')
	assertEquals(checkStringI18nKey(LEAVE_LIKE, 'chat.hub.group.context.leave.main'), null)
	assertEquals(checkStringI18nKey(LEAVE_LIKE, 'chat.hub.send.failed'), null)
})

Deno.test('switch leaf is string-like for refs', () => {
	const root = {
		chat: {
			hub: {
				unread: {
					switch: 'count',
					default: '${count} items',
					cases: { 1: '1 item' },
				},
				badge: {
					'aria-label': {
						switch: 'count',
						default: '${count} unread',
						cases: { 1: '1 unread' },
					},
				},
			},
		},
	}
	assertEquals(checkStringI18nKey(root, 'chat.hub.unread'), null)
	assertEquals(checkElementI18nKey(root, 'chat.hub.unread'), null)
	assertEquals(checkElementI18nKey(root, 'chat.hub.badge'), null)
})

Deno.test('extract + scan catches data-i18n leave parent and CLI stale keys', () => {
	const html = '<button data-i18n="chat.hub.group.context.leave"></button>\n<button data-i18n="chat.hub.group.context.leave.main"></button>\n'
	const htmlIssues = scanSourceI18nRefs(LEAVE_LIKE, html, 'leave.html')
	assert(htmlIssues.some(i => i.kind === 'object_not_element' && i.key === 'chat.hub.group.context.leave'))
	assert(!htmlIssues.some(i => i.key === 'chat.hub.group.context.leave.main'))

	const js = 'setElementI18n(btn, \'chat.hub.group.context.leave\')\nshowToastI18n(\'success\', \'chat.hub.group.context.leave.ok\')\n'
	const jsIssues = scanSourceI18nRefs(LEAVE_LIKE, js, 'leave.mjs')
	assert(jsIssues.some(i => i.kind === 'object_not_element' && i.key === 'chat.hub.group.context.leave'))
	assertEquals(jsIssues.filter(i => i.key === 'chat.hub.group.context.leave.ok').length, 0)

	const staleCli = 'Write-Host (Get-I18n -key \'remove.removingFount\')\nget_i18n \'remove.removing.fount.main\'\nprint_i18n_red \'eula.required\'\n'
	assertEquals(extractFountConsolePathKeys(staleCli).map(r => r.key), [
		'remove.removingFount',
		'remove.removing.fount.main',
		'eula.required',
	])
	const cliIssues = scanFountConsolePathScript(LEAVE_LIKE, staleCli, 'fount.ps1')
	assert(cliIssues.some(i => i.kind === 'missing' && i.key === 'remove.removingFount'))
	assert(!cliIssues.some(i => i.key === 'remove.removing.fount.main'))
})

Deno.test('extractI18nRefsFromSource skips data-i18n literals', () => {
	const refs = extractI18nRefsFromSource('data-i18n="\'plain\';chat.hub.send.main"')
	assertEquals(refs.map(r => r.key), ['chat.hub.send.main'])
})

Deno.test('handleError first-arg key only when imported from frontend features/errorHandlers', () => {
	const frontend = `
import { handleError } from '/scripts/features/errorHandlers.mjs'
handleError('cabinet.bootstrapFailed')
.catch(handleError('chat.hub.send.failed'))
`
	assertEquals(
		extractI18nRefsFromSource(frontend).filter(r => r.binding === 'string').map(r => r.key),
		['cabinet.bootstrapFailed', 'chat.hub.send.failed'],
	)

	const backend = `
import { handleError } from 'fount/scripts/errorHandlers.mjs'
handleError('not.an.i18n.key')
await work().catch(handleError)
`
	assertEquals(
		extractI18nRefsFromSource(backend).filter(r => r.key === 'not.an.i18n.key'),
		[],
	)
})

Deno.test('I18N_REWRITE_SUFFIXES includes shell scripts', () => {
	assert(I18N_REWRITE_SUFFIXES.includes('.sh'))
	assert(I18N_REWRITE_SUFFIXES.includes('.ps1'))
})

/**
 * @param {string} relativePath 相对仓库路径
 * @returns {boolean} 扫描时应跳过
 */
function skipRepoI18nScanPath(relativePath) {
	if (relativePath.includes('/locales/')) return true
	if (relativePath.startsWith('src/scripts/checks/')) return true
	if (relativePath.startsWith('src/decl/')) return true
	return false
}

Deno.test('repo: element/string i18n refs and fountConsole.path CLI keys resolve', async () => {
	const locale = JSON.parse(await readFile(join(REPO_ROOT, 'src/public/locales/zh-CN.json'), 'utf8'))
	const sourceFiles = await listRepoFiles(REPO_ROOT, ['.html', '.mjs', '.js', '.ts'], {
		under: 'src',
	})
	/** @type {import('../i18n_refs.mjs').I18nRefIssue[]} */
	const issues = []
	for (const relativePath of sourceFiles) {
		if (skipRepoI18nScanPath(relativePath)) continue
		const text = await readFile(join(REPO_ROOT, relativePath), 'utf8')
		issues.push(...scanSourceI18nRefs(locale, text, relativePath))
	}
	const cliFiles = [
		...await listRepoFiles(REPO_ROOT, ['.ps1', '.sh'], { under: 'path' }),
		'src/runner/main.ps1',
		'src/runner/main.sh',
	]
	for (const relativePath of cliFiles) {
		const text = await readFile(join(REPO_ROOT, relativePath), 'utf8')
		issues.push(...scanFountConsolePathScript(locale, text, relativePath))
	}
	assertEquals(
		issues.map(i => `${i.path}:${i.line} [${i.kind}] ${i.message}`),
		[],
		issues.map(i => `${i.path}:${i.line} [${i.kind}] ${i.message}`).join('\n'),
	)
})
