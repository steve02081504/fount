#!/usr/bin/env -S deno run -A
/* global Deno */
/**
 * 列出平行 locale markdown 的行级结构不一致（行数 / 标题 / 加粗 / 斜体 / 链接等）。
 *
 * 用法：
 *   deno run --allow-scripts --allow-all ./src/scripts/checks/tools/scan_locale_md_align.mjs
 *   deno run --allow-scripts --allow-all ./src/scripts/checks/tools/scan_locale_md_align.mjs docs/EULA
 *   deno run --allow-scripts --allow-all ./src/scripts/checks/tools/scan_locale_md_align.mjs docs/readme
 */
import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import { formatLocaleMdAlignIssue, scanLocaleMdAlign } from '../locale_md_align.mjs'

const dirs = Deno.args.length ? Deno.args : undefined
const { files, issues } = await scanLocaleMdAlign(REPO_ROOT, dirs ? { dirs } : {})

if (!issues.length) {
	console.log(dirs ? `${dirs.join(', ')}: 结构对齐` : '默认目录: 结构对齐')
	Deno.exit(0)
}

console.log(`${issues.length} 处不对齐，${files.length} 个文件：\n`)
for (const issue of issues)
	console.log(formatLocaleMdAlignIssue(issue))

Deno.exit(1)
