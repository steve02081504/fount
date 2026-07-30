/**
 * 对全部 locale JSON 跑前缀嵌套，写出 old→new 映射，并改写仓库内引号中的 i18n 键。
 *
 * 用法：
 *   deno run --allow-scripts --allow-all -c deno.json src/scripts/checks/tools/reshape_i18n_keys.mjs
 *   deno run ... reshape_i18n_keys.mjs path/to/extra_renames.json
 *
 * extra_renames.json 为一次性语义改名表 `{ "old.path": "new.path", ... }`（与
 * update_locale_data.py 的 @script 同类：临时文件，不进仓库）。跑完可删。
 * 省略则只做前缀嵌套 + 引用改写。
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	nestAllPrefixClusters,
	nestAllPrefixClustersWithMap,
	scanI18nKeyStructure,
} from '../i18n_keys.mjs'
import {
	I18N_REWRITE_SUFFIXES,
	isI18nRewriteExcluded,
	listRepoFiles,
	loadGitignore,
} from '../walk.mjs'

const LOCALES_DIR = join(REPO_ROOT, 'src/public/locales')

/**
 * @param {string | undefined} arg
 * @returns {Promise<Record<string, string>>}
 */
async function loadExtraManualMap(arg) {
	if (!arg) return {}
	const abs = isAbsolute(arg) ? arg : resolve(process.cwd(), arg)
	return JSON.parse(await readFile(abs, 'utf8'))
}

/**
 * @param {Map<string, string>} map
 * @param {string} from
 * @param {string} to
 */
function mapPut(map, from, to) {
	map.set(from, to)
	for (const [k, v] of [...map.entries()]) {
		if (k === from) continue
		if (v === from || v.startsWith(`${from}.`))
			map.set(k, to + v.slice(from.length))
	}
}

/**
 * 自动嵌套映射为底，extraManual 后写入（同键以手动为准，并连锁更新中间目标）。
 * @param {Map<string, string>} autoMap
 * @param {Record<string, string>} extraManual
 * @returns {Map<string, string>}
 */
function combineMaps(autoMap, extraManual) {
	/** @type {Map<string, string>} */
	const pathMap = new Map(autoMap)
	for (const [from, to] of Object.entries(extraManual))
		mapPut(pathMap, from, to)
	return pathMap
}

/**
 * @param {string} text
 * @param {Map<string, string>} map
 * @returns {{ text: string, hits: number }}
 */
function rewriteQuotedKeys(text, map) {
	const entries = [...map.entries()].sort((a, b) => b[0].length - a[0].length)
	let hits = 0
	let out = text
	for (const [from, to] of entries) {
		if (from === to) continue
		const allowPrefix = !to.startsWith(`${from}.`)
		for (const quote of ["'", '"', '`']) {
			const exact = `${quote}${from}${quote}`
			const exactRepl = `${quote}${to}${quote}`
			if (out.includes(exact)) {
				const parts = out.split(exact)
				hits += parts.length - 1
				out = parts.join(exactRepl)
			}
			if (!allowPrefix) continue
			const prefix = `${quote}${from}.`
			const prefixRepl = `${quote}${to}.`
			if (out.includes(prefix)) {
				const parts = out.split(prefix)
				hits += parts.length - 1
				out = parts.join(prefixRepl)
			}
		}
	}
	return { text: out, hits }
}

/**
 * After automatic nesting, chase manual old→new targets that were nested further.
 * @param {Map<string, string>} pathMap
 * @param {Record<string, string>} extraManual
 */
function reconcileExtraThroughNest(pathMap, extraManual) {
	for (const [from, to] of Object.entries(extraManual)) {
		let cur = to
		while (pathMap.has(cur) && pathMap.get(cur) !== cur) {
			const next = pathMap.get(cur)
			if (!next || next === cur) break
			cur = next
			if (cur === from) break
		}
		if (cur !== to) mapPut(pathMap, from, cur)
	}
}

async function main() {
	const extraManual = await loadExtraManualMap(process.argv[2])
	const localeFiles = (await readdir(LOCALES_DIR)).filter(f => f.endsWith('.json'))

	const zhPath = join(LOCALES_DIR, 'zh-CN.json')
	const zhData = JSON.parse(await readFile(zhPath, 'utf8'))
	/** @type {Map<string, string>} */
	const autoMap = new Map()
	nestAllPrefixClustersWithMap(zhData, '', autoMap)

	const leftover = scanI18nKeyStructure(zhData)
	if (leftover.length) {
		console.error('zh-CN still has issues after nest:')
		for (const issue of leftover) console.error(`  [${issue.kind}] ${issue.path}: ${issue.message}`)
		process.exitCode = 1
		return
	}

	const pathMap = combineMaps(autoMap, extraManual)
	reconcileExtraThroughNest(pathMap, extraManual)

	await writeFile(zhPath, `${JSON.stringify(zhData, null, '\t')}\n`, 'utf8')
	for (const file of localeFiles) {
		if (file === 'zh-CN.json') continue
		const abs = join(LOCALES_DIR, file)
		const data = JSON.parse(await readFile(abs, 'utf8'))
		nestAllPrefixClusters(data)
		await writeFile(abs, `${JSON.stringify(data, null, '\t')}\n`, 'utf8')
	}

	const ignore = await loadGitignore(REPO_ROOT)
	const sourceRels = await listRepoFiles(REPO_ROOT, [...I18N_REWRITE_SUFFIXES], { ignore })

	for (const rel of sourceRels) {
		if (isI18nRewriteExcluded(rel)) continue
		const abs = join(REPO_ROOT, rel)
		const raw = await readFile(abs, 'utf8')
		const { text, hits } = rewriteQuotedKeys(raw, pathMap)
		if (!hits) continue
		await writeFile(abs, text, 'utf8')
	}

	const mapPath = join(REPO_ROOT, 'data/test/i18n_key_rename_map.json')
	await writeFile(mapPath, `${JSON.stringify(Object.fromEntries(
		[...pathMap.entries()].sort((a, b) => a[0].localeCompare(b[0])),
	), null, '\t')}\n`, 'utf8')
}

await main()
