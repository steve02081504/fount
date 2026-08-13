/**
 * manifest `skip_because`：GitHub issue URL / `{ url, delay, as }` 或其数组。
 * 仍开或关闭未满 delay → 跳过；`as` 默认 `pass`（当绿，下游照常），`skip_tree` 连下游一起跳过。
 * 关闭且已过 delay → 失败。
 */
import { parseExpectedMs } from './expected.mjs'
import { parseGithubIssueUrl } from './github_issue.mjs'
import { suiteKey } from './state.mjs'

/**
 * skip 当绿（下游放行）或连同依赖树一起跳过。
 * @typedef {'pass' | 'skip_tree'} SkipBecauseAs
 */

/**
 * @typedef {object} SkipBecauseEntry
 * @property {string} url GitHub issue URL
 * @property {number} delayMs 关闭后的延缓（毫秒）；0 表示关闭即失败
 * @property {SkipBecauseAs} as 跳过方式
 */

/**
 * @typedef {object} IssueClosedState
 * @property {boolean} closed 是否已关闭
 * @property {number | null} closedAt 关闭时刻（unix ms）；未知为 null
 */

/**
 * 按 URL 去重：同 URL 取较大 delay，`skip_tree` 盖过 `pass`。
 * @param {SkipBecauseEntry[][]} lists 条目列表
 * @returns {SkipBecauseEntry[]} 去重后的条目
 */
function mergeEntries(lists) {
	/** @type {Map<string, SkipBecauseEntry>} */
	const byUrl = new Map()
	for (const list of lists)
		for (const entry of list) {
			const prev = byUrl.get(entry.url)
			byUrl.set(entry.url, {
				url: entry.url,
				delayMs: Math.max(prev?.delayMs ?? 0, entry.delayMs),
				as: prev?.as === 'skip_tree' || entry.as === 'skip_tree' ? 'skip_tree' : 'pass',
			})
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
 * 解析 as 字段（缺省 pass）。
 * @param {unknown} raw 原始 as
 * @param {string} label 错误标签
 * @returns {SkipBecauseAs} 跳过方式
 */
function parseAs(raw, label) {
	if (raw == null || raw === '') return 'pass'
	if (raw === 'pass' || raw === 'skip_tree') return raw
	throw new Error(`invalid skip_because as in ${label}: ${raw}`)
}

/**
 * 解析单条 skip_because 项。
 * @param {unknown} item URL 或 { url, delay, as }
 * @param {string} label 错误标签
 * @returns {SkipBecauseEntry | null} 条目；空字符串为 null
 */
function parseItem(item, label) {
	if (typeof item === 'string') {
		const url = item.trim()
		if (!url) return null
		if (!parseGithubIssueUrl(url))
			throw new Error(`invalid skip_because URL in ${label}: ${url}`)
		return { url, delayMs: 0, as: 'pass' }
	}
	if (!item || typeof item !== 'object' || Array.isArray(item))
		throw new Error(`skip_because in ${label} must be a URL, {url, delay, as}, or an array of them`)
	const rec = /** @type {{ url?: unknown, delay?: unknown, as?: unknown }} */ item
	const url = String(rec.url ?? '').trim()
	if (!parseGithubIssueUrl(url))
		throw new Error(`invalid skip_because URL in ${label}: ${url}`)
	return { url, delayMs: parseDelayMs(rec.delay, label), as: parseAs(rec.as, label) }
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
 * 条目汇总后的跳过方式。
 * @param {SkipBecauseEntry[] | undefined} entries 条目
 * @returns {SkipBecauseAs | undefined} 有 skip 时的 as
 */
export function skipBecauseAs(entries) {
	if (!entries?.length) return undefined
	return entries.some(entry => entry.as === 'skip_tree') ? 'skip_tree' : 'pass'
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
 * @param {import('./manifest.mjs').SuiteDef | undefined} suite suite
 * @returns {SkipBecauseEntry[] | undefined} 条目
 */
export function suiteSkipBecauseUrls(suite) {
	if (!suite) return undefined
	return skipBecauseEntriesForRun(suite)
}

/**
 * suite 整场 skip 的 as；无 skip 为 undefined。
 * @param {import('./manifest.mjs').SuiteDef | undefined} suite suite
 * @returns {SkipBecauseAs | undefined} as
 */
export function skipBecauseAsForSuite(suite) {
	return skipBecauseAs(suiteSkipBecauseUrls(suite))
}

/**
 * skip 当绿（下游放行）。
 * @param {import('./manifest.mjs').SuiteDef | undefined} suite suite
 * @returns {boolean} 是否 pass 模式
 */
export function isSkipBecausePass(suite) {
	return skipBecauseAsForSuite(suite) === 'pass'
}

/**
 * skip 连同依赖树一起跳过。
 * @param {import('./manifest.mjs').SuiteDef | undefined} suite suite
 * @returns {boolean} 是否 skip_tree
 */
export function isSkipBecauseSkipTree(suite) {
	return skipBecauseAsForSuite(suite) === 'skip_tree'
}

/**
 * 被 skip_tree 根挡住的全部下游（不含根自身）。
 * @param {import('./manifest.mjs').SuiteDef[]} allSuites 全部 suite
 * @returns {Set<string>} 下游 suite 键
 */
export function skipTreeDescendantKeys(allSuites) {
	const roots = new Set(
		allSuites.filter(isSkipBecauseSkipTree).map(suite => suiteKey(suite.manifestId, suite.name)),
	)
	if (!roots.size) return new Set()
	const under = new Set(roots)
	let grew = true
	while (grew) {
		grew = false
		for (const suite of allSuites) {
			const key = suiteKey(suite.manifestId, suite.name)
			if (under.has(key)) continue
			if (suite.dependencies?.some(dep => under.has(suiteKey(dep.manifestId, dep.name)))) {
				under.add(key)
				grew = true
			}
		}
	}
	for (const root of roots) under.delete(root)
	return under
}

/**
 * blocked 记录是否仅被 pass 模式 skip 挡住（阻塞已作废，当绿）。
 * @param {import('./state.mjs').SuiteStateEntry | undefined} entry 现状
 * @param {Map<string, import('./manifest.mjs').SuiteDef>} byKey suite 表
 * @returns {boolean} 是否作废阻塞
 */
export function isPassSkipBlock(entry, byKey) {
	if (entry?.status !== 'blocked' || !entry.blockedBy?.length) return false
	return entry.blockedBy.every(key => isSkipBecausePass(byKey.get(key)))
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
