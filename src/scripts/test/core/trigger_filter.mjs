/**
 * trigger 匹配排除路径（文档、test manifest 元数据等）。
 * manifest / suite 的 `triggerFilter` 可覆盖默认表 — 见 docs/trigger-filter.md。
 */
import { matchGlob } from './glob.mjs'

/**
 * manifest / suite 级 trigger 过滤选项。
 * @typedef {object} TriggerFilter
 * @property {boolean} [ignoreDefaults] 是否应用默认忽略表；默认 true
 * @property {string[]} [ignore] 额外忽略 glob
 * @property {string[]} [unignore] 强制纳入（优先于 ignore）
 */

/** @type {readonly string[]} */
const DEFAULT_IGNORE_PATTERNS = [
	'**/AGENTS.md',
	'**/test/manifest.json',
	'**/docs/**',
	'**/*.md',
	'*.md',
	'**/llms.txt',
]

/**
 * 合并 manifest 级与 suite 级 triggerFilter。
 * @param {TriggerFilter | undefined} manifestFilter manifest 级过滤
 * @param {TriggerFilter | undefined} suiteFilter suite 级过滤（覆盖 manifest）
 * @returns {TriggerFilter | undefined} 合并结果；默认表未变时为 undefined
 */
export function mergeTriggerFilter(manifestFilter, suiteFilter) {
	if (!manifestFilter && !suiteFilter) return undefined
	const m = manifestFilter ?? {}
	const s = suiteFilter ?? {}
	const ignoreDefaults = s.ignoreDefaults ?? m.ignoreDefaults ?? true
	const ignore = [...m.ignore ?? [], ...s.ignore ?? []]
	const unignore = [...m.unignore ?? [], ...s.unignore ?? []]
	if (ignoreDefaults !== false && !ignore.length && !unignore.length)
		return undefined
	/** @type {TriggerFilter} */
	const merged = { ignoreDefaults }
	if (ignore.length) merged.ignore = ignore
	if (unignore.length) merged.unignore = unignore
	return merged
}

/**
 * 判定仓库相对路径是否计入 trigger 相关变更。
 * @param {string} path 仓库相对路径
 * @param {TriggerFilter | undefined} [filter] 合并后的 trigger 过滤
 * @returns {boolean} 路径是否 trigger 相关
 */
function isTriggerRelevantPath(path, filter) {
	if (filter?.unignore?.some(pat => matchGlob(pat, path)))
		return true
	/** @type {string[]} */
	const ignore = []
	if (filter?.ignoreDefaults !== false)
		ignore.push(...DEFAULT_IGNORE_PATTERNS)
	if (filter?.ignore?.length)
		ignore.push(...filter.ignore)
	return !ignore.some(pat => matchGlob(pat, path))
}

/**
 * 过滤变更路径，仅保留 trigger 相关项。
 * @param {string[]} files 变更路径
 * @param {TriggerFilter | undefined} [filter] 合并后的 trigger 过滤
 * @returns {string[]} 过滤后仍 trigger 相关的路径
 */
export function filterTriggerRelevantFiles(files, filter) {
	return files.filter(file => isTriggerRelevantPath(file, filter))
}
