/**
 * manifest `skip_because`：GitHub issue URL 数组；全部仍开则跳过当成功，任一已关则失败。
 */
import { parseGithubIssueUrl } from './github_issue.mjs'

/**
 * 去重并保持顺序。
 * @param {string[][]} lists URL 列表
 * @returns {string[]} 去重后的 URL
 */
function uniqueUrls(lists) {
	const seen = new Set()
	/** @type {string[]} */
	const out = []
	for (const list of lists)
		for (const url of list)
			if (!seen.has(url)) {
				seen.add(url)
				out.push(url)
			}
	return out
}

/**
 * 解析并校验 skip_because 字段（URL 数组）。
 * @param {unknown} raw 原始字段
 * @param {string} label 错误标签
 * @returns {string[] | undefined} 规范 issue URL 列表
 */
export function parseSkipBecause(raw, label) {
	if (raw == null || raw === '') return undefined
	if (!Array.isArray(raw))
		throw new Error(`skip_because in ${label} must be an array of GitHub issue URLs`)
	const urls = uniqueUrls([raw.map(item => String(item).trim()).filter(Boolean)])
	if (!urls.length) return undefined
	for (const url of urls)
		if (!parseGithubIssueUrl(url))
			throw new Error(`invalid skip_because URL in ${label}: ${url}`)
	return urls
}

/**
 * 已关闭 URL 列表 → 调度动作。任一已关即失败。
 * @param {string[]} closed 已关闭的 URL
 * @returns {'pass' | 'fail'} pass=不跑当成功；fail=不跑当失败
 */
export function skipBecauseAction(closed) {
	return closed.length ? 'fail' : 'pass'
}

/**
 * 本次调度要探测的 skip URL（suite 级，或本次子测试全部都标了则取并集）。
 * @param {import('./manifest.mjs').SuiteDef} suite suite
 * @param {string[]} [subtests] 本次子测试
 * @returns {string[] | undefined} issue URL 列表
 */
export function skipBecauseUrlsForRun(suite, subtests) {
	if (suite.skipBecause?.length) return suite.skipBecause
	const targets = subtests?.length
		? suite.subtests?.filter(st => subtests.includes(st.name))
		: suite.subtests
	if (!targets?.length) return undefined
	if (!targets.every(st => st.skipBecause?.length)) return undefined
	return uniqueUrls(targets.map(st => st.skipBecause))
}

/**
 * suite 级或「全部子测试都标了」时的 skip URL。
 * @param {import('./manifest.mjs').SuiteDef} suite suite
 * @returns {string[] | undefined} issue URL 列表
 */
export function suiteSkipBecauseUrls(suite) {
	return skipBecauseUrlsForRun(suite)
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
