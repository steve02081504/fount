/**
 * Paths excluded from trigger matching (docs, test manifest metadata, etc.).
 * Manifest / suite `triggerFilter` overrides defaults — see docs/trigger-filter.md.
 */
import { matchGlob } from './glob.mjs'

/**
 * @typedef {object} TriggerFilter
 * @property {boolean} [ignoreDefaults] apply default ignore table; default true
 * @property {string[]} [ignore] extra ignore globs
 * @property {string[]} [unignore] force inclusion (wins over ignore)
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
 * Merge manifest- and suite-level triggerFilter.
 * @param {TriggerFilter | undefined} manifestFilter
 * @param {TriggerFilter | undefined} suiteFilter
 * @returns {TriggerFilter | undefined}
 */
export function mergeTriggerFilter(manifestFilter, suiteFilter) {
	if (!manifestFilter && !suiteFilter) return undefined
	const m = manifestFilter ?? {}
	const s = suiteFilter ?? {}
	const ignoreDefaults = s.ignoreDefaults ?? m.ignoreDefaults ?? true
	const ignore = [...(m.ignore ?? []), ...(s.ignore ?? [])]
	const unignore = [...(m.unignore ?? []), ...(s.unignore ?? [])]
	if (ignoreDefaults !== false && !ignore.length && !unignore.length)
		return undefined
	/** @type {TriggerFilter} */
	const merged = { ignoreDefaults }
	if (ignore.length) merged.ignore = ignore
	if (unignore.length) merged.unignore = unignore
	return merged
}

/**
 * @param {string} path repo-relative path
 * @param {TriggerFilter | undefined} [filter]
 * @returns {boolean}
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
 * @param {string[]} files changed paths
 * @param {TriggerFilter | undefined} [filter]
 * @returns {string[]}
 */
export function filterTriggerRelevantFiles(files, filter) {
	return files.filter(file => isTriggerRelevantPath(file, filter))
}
