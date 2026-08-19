/**
 * 仓库完整 HTML：元数据、main、drawer-toggle、aside ARIA。
 */
/* global Deno */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assertEquals, assert } from 'https://deno.land/std/assert/mod.ts'
import { parseHTML } from 'npm:linkedom'

import { DOC_LOCALE_ALIAS, resolveDocLocale } from '../../../../.github/pages/scripts/i18n/redirect_dict.mjs'
import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	checkAsideAriaRoles,
	checkDrawerToggles,
	checkHtmlMeta,
	hasHtmlIssues,
	hasMainLandmark,
	inspectHtmlDocument,
	isFullHtmlDocument,
} from '../html_meta.mjs'
import { listRepoFiles } from '../walk.mjs'

Deno.test('isFullHtmlDocument detects doctype / html root', () => {
	assertEquals(isFullHtmlDocument('<!DOCTYPE html><html></html>'), true)
	assertEquals(isFullHtmlDocument('<html lang="zh"></html>'), true)
	assertEquals(isFullHtmlDocument('<div>fragment</div>'), false)
})

Deno.test('inspectHtmlDocument accepts complete fixture', () => {
	const good = `<!DOCTYPE html><html><head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width">
		<meta property="og:title" content="t">
		<meta property="og:type" content="website">
		<meta property="og:description" content="d">
		<meta property="og:image" content="i.png">
		<link rel="icon" href="icon.svg">
		<title>t</title>
		<meta name="description" content="d">
	</head><body><main></main><input class="drawer-toggle" aria-hidden="true"><aside></aside></body></html>`
	const ok = inspectHtmlDocument(good)
	assertEquals(ok.skipped, false)
	assertEquals(hasHtmlIssues(ok), false)
})

Deno.test('inspectHtmlDocument reports meta / main / drawer / aside issues', () => {
	const bad = `<!DOCTYPE html><html><head><title>only</title></head>
		<body>
			<aside role="dialog" id="bad-aside"></aside>
			<input class="drawer-toggle" id="naked-toggle">
		</body></html>`
	const result = inspectHtmlDocument(bad)
	assertEquals(result.skipped, false)
	assert(!result.skipped)
	assertEquals(result.missingMain, true)
	assert(result.badAsideRoles.some(s => s.includes('dialog')))
	assert(result.badToggles.some(s => s.includes('naked-toggle')))
	assert(result.missingMeta.includes('<meta charset>'))

	const { document } = parseHTML(bad)
	assertEquals(hasMainLandmark(document), false)
	assert(checkHtmlMeta(document).length > 0)
	assert(checkDrawerToggles(document).length > 0)
	assert(checkAsideAriaRoles(document).length > 0)
})

Deno.test('repo full HTML documents pass html meta checks', async () => {
	// PHP 诱饵页刻意还原 2002 年 Apache 页面，不属于 fount UI，跳过现代 meta 检查。
	const files = (await listRepoFiles(REPO_ROOT, ['.html'])).filter(rel => !/\.php\.html$/u.test(rel))
	/** @type {string[]} */
	const failures = []
	let checked = 0
	for (const rel of files) {
		const content = await readFile(join(REPO_ROOT, rel), 'utf8')
		const result = inspectHtmlDocument(content)
		if (result.skipped) continue
		checked++
		if (!hasHtmlIssues(result)) continue
		const parts = []
		if (result.missingMeta.length)
			parts.push(`缺少元数据: ${result.missingMeta.join(', ')}`)
		if (result.missingMain)
			parts.push('缺少 <main>')
		if (result.badToggles.length)
			parts.push(`drawer-toggle: ${result.badToggles.join('; ')}`)
		if (result.badAsideRoles.length)
			parts.push(`aside role: ${result.badAsideRoles.join('; ')}`)
		failures.push(`${rel}: ${parts.join(' | ')}`)
	}
	assert(checked > 0, '未找到任何完整 HTML 文档')
	assertEquals(failures, [], failures.join('\n'))
})

/**
 * 语言跳转页必须引用共享 dict，且 dict 点名每个 Stem.locale.md。
 * @param {string} htmlRel 跳转页路径
 * @param {string} dir markdown 目录
 * @param {string} stem 文件名前缀
 * @param {string} blobNeedle blob URL 中的路径片段
 * @returns {Promise<void>}
 */
async function assertRedirectCoversStem(htmlRel, dir, stem, blobNeedle) {
	const html = await readFile(join(REPO_ROOT, htmlRel), 'utf8')
	assert(html.includes(blobNeedle), `redirect blob prefix ${blobNeedle}`)
	assert(html.includes('redirect_dict.mjs'), `${htmlRel} 应引用 redirect_dict.mjs`)
	const files = (await readdir(join(REPO_ROOT, dir)))
		.filter(name => name.startsWith(`${stem}.`) && name.endsWith('.md'))
	assert(files.length > 0, `${dir} 中没有 ${stem}.*.md`)
	const locales = new Set([...Object.keys(DOC_LOCALE_ALIAS), ...Object.values(DOC_LOCALE_ALIAS)])
	assertEquals(
		files.filter(name => !locales.has(name.slice(`${stem}.`.length, -'.md'.length))),
		[],
	)
}

Deno.test('resolveDocLocale maps tags, prefixes, and unknown to en-UK', () => {
	assertEquals(resolveDocLocale('zh-HK'), 'zh-TW')
	assertEquals(resolveDocLocale('zh-Hant'), 'zh-TW')
	assertEquals(resolveDocLocale('zh-hant-hk'), 'zh-TW')
	assertEquals(resolveDocLocale('zh-Hans'), 'zh-CN')
	assertEquals(resolveDocLocale('zh-hans-cn'), 'zh-CN')
	assertEquals(resolveDocLocale('en-GB'), 'en-UK')
	assertEquals(resolveDocLocale('pt-BR'), 'pt-PT')
	assertEquals(resolveDocLocale('ja'), 'ja-JP')
	assertEquals(resolveDocLocale('xx-YY'), 'en-UK')
})

Deno.test('pages readme redirect and root flags cover docs/readme locales', async () => {
	await assertRedirectCoversStem(
		'.github/pages/readme/index.html',
		'docs/readme',
		'Readme',
		'docs/readme/Readme',
	)
	const rootReadme = await readFile(join(REPO_ROOT, 'README.md'), 'utf8')
	const files = (await readdir(join(REPO_ROOT, 'docs/readme')))
		.filter(name => name.startsWith('Readme.') && name.endsWith('.md'))
	assertEquals(
		files.filter(name => !rootReadme.includes(`./docs/readme/${name}`)),
		[],
	)
})

Deno.test('pages EULA redirect covers docs/EULA locales', async () => {
	await assertRedirectCoversStem(
		'.github/pages/EULA/index.html',
		'docs/EULA',
		'EULA',
		'docs/EULA/EULA',
	)
})
