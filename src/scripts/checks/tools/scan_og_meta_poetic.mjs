#!/usr/bin/env -S deno run -A
/* global Deno */
/**
 * 列出仓库中全部 HTML 的 og:title / og:description。
 *
 * 用法：
 *   deno run --allow-scripts --allow-all ./src/scripts/checks/tools/scan_og_meta_poetic.mjs
 *   deno run --allow-scripts --allow-all ./src/scripts/checks/tools/scan_og_meta_poetic.mjs src/public/parts/shells
 */
import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import { listOgMeta } from '../og_meta_list.mjs'

const under = Deno.args[0] || ''
const { files, entries } = await listOgMeta(REPO_ROOT, under ? { under } : {})

const scope = under || '仓库'
console.log(`${scope}: ${entries.length} 个 HTML 含 og meta（共 ${files.length} 个 .html）\n`)

for (const entry of entries.sort((a, b) => a.path.localeCompare(b.path))) {
	console.log(entry.path)
	console.log(`  og:title: ${entry.title}`)
	console.log(`  og:description: ${entry.description}`)
	console.log()
}
