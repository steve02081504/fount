#!/usr/bin/env -S deno run -A
/* global Deno */
/**
 * 列出仓库中纯英文 / 缺摘要的 JSDoc（违反 jsdoc_no_english）。
 *
 * 用法：
 *   deno run -A ./src/scripts/checks/tools/scan_jsdoc_no_english.mjs
 *   deno run -A ./src/scripts/checks/tools/scan_jsdoc_no_english.mjs imgs/icon_anime
 */
import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import { scanJsdocNoEnglish } from '../jsdoc_no_english.mjs'

const under = Deno.args[0] || ''
const { files, issues } = await scanJsdocNoEnglish(REPO_ROOT, under ? { under } : {})

if (!issues.length) {
	console.log(under ? `${under}: 无英文 JSDoc` : '仓库: 无英文 JSDoc')
	Deno.exit(0)
}

const byFile = new Map()
for (const issue of issues) {
	const list = byFile.get(issue.path) ?? []
	list.push(issue)
	byFile.set(issue.path, list)
}

console.log(`${issues.length} 处英文/缺摘要 JSDoc，${files.length} 个文件：\n`)
for (const path of [...byFile.keys()].sort()) {
	console.log(path)
	for (const issue of byFile.get(path))
		console.log(`  L${issue.line}: ${issue.missingSummary ? '(缺摘要)' : issue.summary}`)
	console.log()
}

Deno.exit(1)
