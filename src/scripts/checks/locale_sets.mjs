/**
 * EULA / README / fount 产品 locale 集合：同一套语言 id，禁止各写各的。
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 读 `list.csv` 第一列语言 id。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<string[]>} 排序后的 id
 */
export async function loadListCsvLocales(repoRoot) {
	const text = await readFile(join(repoRoot, 'src/public/locales/list.csv'), 'utf8')
	const ids = []
	for (const line of text.split('\n').slice(1)) {
		const id = line.split(',')[0]?.trim()
		if (id) ids.push(id)
	}
	return uniqueSorted(ids)
}

/**
 * `src/public/locales/*.json` 文件名（不含扩展名）。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<string[]>} 排序后的 id
 */
export async function loadLocaleJsonIds(repoRoot) {
	const names = await readdir(join(repoRoot, 'src/public/locales'))
	return uniqueSorted(names.filter(name => name.endsWith('.json')).map(name => name.slice(0, -'.json'.length)))
}

/**
 * `Stem.locale.md` 族的 locale 段。
 * @param {string} repoRoot 仓库根
 * @param {string} relDir 相对目录
 * @param {string} stem 文件名前缀（如 `EULA` / `Readme`）
 * @returns {Promise<string[]>} 排序后的 id
 */
export async function loadStemLocales(repoRoot, relDir, stem) {
	const names = await readdir(join(repoRoot, relDir))
	const prefix = `${stem}.`
	return uniqueSorted(
		names.filter(name => name.startsWith(prefix) && name.endsWith('.md'))
			.map(name => name.slice(prefix.length, -'.md'.length)),
	)
}

/**
 * @param {string[]} ids 语言 id
 * @returns {string[]} 去重排序
 */
function uniqueSorted(ids) {
	return [...new Set(ids)].sort()
}

/**
 * 比较多组 locale id，返回缺席项。
 * @param {Record<string, string[]>} sets 名称 → id 列表
 * @returns {{ id: string, missing: string[] }[]} 某 id 未出现在哪些集合
 */
export function diffLocaleSets(sets) {
	const names = Object.keys(sets)
	const union = new Set()
	const membership = new Map()
	for (const name of names) {
		const list = sets[name]
		membership.set(name, new Set(list))
		for (const id of list) union.add(id)
	}
	/** @type {{ id: string, missing: string[] }[]} */
	const issues = []
	for (const id of [...union].sort()) {
		const missing = names.filter(name => !membership.get(name).has(id))
		if (missing.length) issues.push({ id, missing })
	}
	return issues
}

/**
 * 仓库内 EULA / README / list.csv / locale JSON 是否同一套语言。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<{ sets: Record<string, string[]>, issues: { id: string, missing: string[] }[] }>} 各组 id 与缺席项
 */
export async function scanLocaleIdSets(repoRoot) {
	const sets = {
		'list.csv': await loadListCsvLocales(repoRoot),
		'locales/*.json': await loadLocaleJsonIds(repoRoot),
		'docs/EULA': await loadStemLocales(repoRoot, 'docs/EULA', 'EULA'),
		'docs/readme': await loadStemLocales(repoRoot, 'docs/readme', 'Readme'),
	}
	return { sets, issues: diffLocaleSets(sets) }
}
