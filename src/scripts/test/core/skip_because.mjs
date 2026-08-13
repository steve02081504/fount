/**
 * manifest `skip_because`：GitHub issue URL / `{ url, delay }` 或其数组。
 * 仍开或关闭未满 delay → 跳过当成功；关闭且已过 delay → 失败。
 */
import { parseExpectedMs } from './expected.mjs'
import { parseGithubIssueUrl } from './github_issue.mjs'

/**
 * @typedef {object} SkipBecauseEntry
 * @property {string} url GitHub issue URL
 * @property {number} delayMs 关闭后的延缓（毫秒）；0 表示关闭即失败
 */

/**
 * @typedef {object} IssueClosedState
 * @property {boolean} closed 是否已关闭
 * @property {number | null} closedAt 关闭时刻（unix ms）；未知为 null
 */

/**
 * 按 URL 去重，同 URL 取较大 delay。
 * @param {SkipBecauseEntry[][]} lists 条目列表
 * @returns {SkipBecauseEntry[]} 去重后的条目
 */
function mergeEntries(lists) {
	/** @type {Map<string, SkipBecauseEntry>} */
	const byUrl = new Map()
	for (const list of lists)
		for (const entry of list) {
			const prev = byUrl.get(entry.url)
			if (!prev || entry.delayMs > prev.delayMs)
				byUrl.set(entry.url, entry)
		}
	return [...byUrl.values()]
}

/**
 * 解析 delay 字段（缺省 0）。
 * @param {unknown} raw 原始 delay
 * @param {string} label 错误标签
 * @returns {number} 毫秒
 */
function parseDelayMs(raw, label) {
	if (raw == null || raw === '') return 0
	if (typeof raw === 'number') {
		if (!Number.isFinite(raw) || raw < 0)
			throw new Error(`invalid skip_because delay in ${label}`)
		return raw
	}
	const ms = parseExpectedMs(raw)
	if (ms == null)
		throw new Error(`invalid skip_because delay in ${label}: ${raw}`)
	return ms
}

/**
 * 解析单条 skip_because 项。
 * @param {unknown} item URL 或 { url, delay }
 * @param {string} label 错误标签
 * @returns {SkipBecauseEntry | null} 条目；空字符串为 null
 */
function parseItem(item, label) {
	if (typeof item === 'string') {
		const url = item.trim()
		if (!url) return null
		if (!parseGithubIssueUrl(url))
			throw new Error(`invalid skip_because URL in ${label}: ${url}`)
		return { url, delayMs: 0 }
	}
	if (!item || typeof item !== 'object' || Array.isArray(item))
		throw new Error(`skip_because in ${label} must be a URL, {url, delay}, or an array of them`)
	const rec = /** @type {{ url?: unknown, delay?: unknown }} */ item
	const url = String(rec.url ?? '').trim()
	if (!parseGithubIssueUrl(url))
		throw new Error(`invalid skip_because URL in ${label}: ${url}`)
	return { url, delayMs: parseDelayMs(rec.delay, label) }
}

/**
 * 解析并校验 skip_because 字段。
 * @param {unknown} raw 原始字段
 * @param {string} label 错误标签
 * @returns {SkipBecauseEntry[] | undefined} 条目列表
 */
export function parseSkipBecause(raw, label) {
	if (raw == null || raw === '') return undefined
	const list = Array.isArray(raw) ? raw : [raw]
	/** @type {SkipBecauseEntry[]} */
	const parsed = []
	for (const item of list) {
		const entry = parseItem(item, label)
		if (entry) parsed.push(entry)
	}
	const entries = mergeEntries([parsed])
	return entries.length ? entries : undefined
}

/**
 * 关闭态是否已过 delay、应判失败。
 * @param {IssueClosedState} state 探测结果
 * @param {number} delayMs 延缓
 * @param {number} [now] 当前时间
 * @returns {boolean} 应失败
 */
export function isSkipBecauseBlocking(state, delayMs, now = Date.now()) {
	if (!state.closed) return false
	if (!delayMs) return true
	if (state.closedAt == null) return true
	return now >= state.closedAt + delayMs
}

/**
 * 已过 delay 的 URL 列表 → 调度动作。
 * @param {string[]} blocking 应失败的 URL
 * @returns {'pass' | 'fail'} pass=不跑当成功；fail=不跑当失败
 */
export function skipBecauseAction(blocking) {
	return blocking.length ? 'fail' : 'pass'
}

/**
 * 本次调度要探测的 skip 条目。
 * @param {import('./manifest.mjs').SuiteDef} suite suite
 * @param {string[]} [subtests] 本次子测试
 * @returns {SkipBecauseEntry[] | undefined} 条目
 */
export function skipBecauseEntriesForRun(suite, subtests) {
	if (suite.skipBecause?.length) return suite.skipBecause
	const targets = subtests?.length
		? suite.subtests?.filter(st => subtests.includes(st.name))
		: suite.subtests
	if (!targets?.length) return undefined
	if (!targets.every(st => st.skipBecause?.length)) return undefined
	return mergeEntries(targets.map(st => st.skipBecause))
}

/**
 * 本次调度要探测的 skip URL。
 * @param {import('./manifest.mjs').SuiteDef} suite suite
 * @param {string[]} [subtests] 本次子测试
 * @returns {string[] | undefined} issue URL 列表
 */
export function skipBecauseUrlsForRun(suite, subtests) {
	const entries = skipBecauseEntriesForRun(suite, subtests)
	return entries?.map(entry => entry.url)
}

/**
 * suite 级或「全部子测试都标了」时的 skip 条目。
 * @param {import('./manifest.mjs').SuiteDef} suite suite
 * @returns {SkipBecauseEntry[] | undefined} 条目
 */
export function suiteSkipBecauseUrls(suite) {
	return skipBecauseEntriesForRun(suite)
}

/**
 * 需要每次调度都重探 issue 的 suite 键。
 * @param {import('./manifest.mjs').SuiteDef[]} suites suite
 * @returns {string[]} suite 键
 */
export function skipBecauseSuiteKeys(suites) {
	return suites.filter(suiteSkipBecauseUrls).map(suite => `${suite.manifestId}:${suite.name}`)
}

/**
 * 终端 / 报告里把 URL 拼成一行。
 * @param {string[]} urls URL
 * @returns {string} 空格分隔
 */
export function formatSkipBecauseUrls(urls) {
	return urls.join(' ')
}
