/**
 * 仓库完整 HTML：元数据、main、drawer-toggle、aside ARIA。
 */
/* global Deno */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assertEquals, assert } from 'https://deno.land/std/assert/mod.ts'
import { parseHTML } from 'npm:linkedom'

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
	const files = await listRepoFiles(REPO_ROOT, ['.html'])
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
