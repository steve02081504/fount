/**
 * 第二遍：仅 exact 替换 rename map（补全 prefix 半截路径）。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	I18N_REWRITE_SUFFIXES,
	isI18nRewriteExcluded,
	listRepoFiles,
	loadGitignore,
} from '../walk.mjs'

const renameMap = JSON.parse(
	await readFile(join(REPO_ROOT, 'data/test/i18n_key_rename_map.json'), 'utf8'),
)

/**
 * 将链式 old→new 展平为终态目标，再按键长降序。
 * @param {Record<string, string>} map 原始 rename map
 * @returns {[string, string][]} 展平后的条目
 */
function flattenRenameEntries(map) {
	/** @type {[string, string][]} */
	const entries = []
	for (const from of Object.keys(map)) {
		let cur = from
		const visited = new Set()
		while (Object.hasOwn(map, cur) && map[cur] !== cur) {
			if (visited.has(cur))
				throw new Error(`Rename map cycle detected involving ${cur}`)
			visited.add(cur)
			cur = map[cur]
		}
		if (cur !== from) entries.push([from, cur])
	}
	return entries
		.filter(([from, to]) => from !== to && !to.startsWith(`${from}.`))
		.sort((a, b) => b[0].length - a[0].length)
}

const entries = flattenRenameEntries(renameMap)

/**
 * @param {string} text 源码文本
 * @returns {{ text: string, hits: number }} 改写结果
 */
function rewriteExact(text) {
	let hits = 0
	let out = text
	for (const [from, to] of entries) 
		for (const quote of ['\'', '"', '`']) {
			const exact = `${quote}${from}${quote}`
			if (!out.includes(exact)) continue
			const parts = out.split(exact)
			hits += parts.length - 1
			out = parts.join(`${quote}${to}${quote}`)
		}
	
	return { text: out, hits }
}

const ignore = await loadGitignore(REPO_ROOT)
const files = await listRepoFiles(REPO_ROOT, [...I18N_REWRITE_SUFFIXES], { ignore })

for (const rel of files) {
	if (isI18nRewriteExcluded(rel)) continue
	const abs = join(REPO_ROOT, rel)
	const raw = await readFile(abs, 'utf8')
	const { text, hits } = rewriteExact(raw)
	if (!hits) continue
	await writeFile(abs, text, 'utf8')
}
