/**
 * axe-core 无障碍扫描；`[aria-ignore]` 校验委托共享策略 + hub 探测。
 */
import axe from 'https://esm.sh/axe-core'

import { ariaIgnoreProblem, collectAriaIgnoreEntries } from '../aria_ignore.mjs'
import { testHubBaseUrl } from '../hub_url.mjs'

import { isClosed, resetIssueProbe } from './hub_issues.mjs'
import { wake } from './loop.mjs'
import { createReporter } from './reporter.mjs'

/** DOM 仍在变时的扫描间隔 */
const A11Y_SCAN_MS = 500

const reporter = createReporter('[test:a11y]')

let dirty = false
let needRefresh = false
let drainPassDone = false
/** @type {(() => void)[]} */
const refreshWaiters = []

/**
 * DOM 变脏并唤醒。
 * @returns {void}
 */
export function markDirty() {
	dirty = true
	wake()
}

/**
 * 要求下一轮带 issue 刷新的扫描；扫完后 resolve。
 * @returns {Promise<void>}
 */
export function requestRefresh() {
	needRefresh = true
	dirty = true
	resetIssueProbe()
	wake()
	return new Promise(resolve => refreshWaiters.push(resolve))
}

/**
 * drain 覆盖是否完成。
 * @returns {boolean} 本轮 drain a11y 已跑完则为 true
 */
function covered() {
	return drainPassDone
}

/**
 * drain 开始：重置覆盖并要求带刷新的扫描。
 * @returns {void}
 */
function beginDrain() {
	drainPassDone = false
	needRefresh = true
	dirty = true
}

/**
 * loop 回调：跑一轮或空转。
 * @param {import('./loop.mjs').WatchTickContext} ctx tick 上下文
 * @returns {Promise<boolean>} true = 空转
 */
async function run({ draining }) {
	const refresh = needRefresh || (draining && !drainPassDone)
	if (!refresh && !dirty) return true
	needRefresh = false
	dirty = false
	try {
		await scan({ refreshGithubIssues: refresh })
	}
	finally {
		for (const resolve of refreshWaiters.splice(0)) resolve()
		if (draining) drainPassDone = true
	}
	return false
}

/**
 * 校验 `[aria-ignore]` 格式与关闭态。
 * @param {{ refresh?: boolean, entries?: import('../aria_ignore.mjs').AriaIgnoreEntry[] }} [options] 选项
 * @returns {Promise<void>} 校验完成
 */
async function checkAriaIgnores({ refresh = false, entries = collectAriaIgnoreEntries() } = {}) {
	const hub = testHubBaseUrl()
	/** @type {{ url: string, where: string }[]} */
	const toProbe = []
	for (const { url, where, parsed } of entries) {
		const staticProblem = ariaIgnoreProblem({ url, where, closed: false })
		if (staticProblem?.code === 'missing-url') {
			reporter.report(`aria-ignore-missing\t${where}`, 'aria-ignore-missing-url', where, staticProblem.message)
			continue
		}
		if (staticProblem?.code === 'bad-url' || !parsed) {
			reporter.report(`aria-ignore-bad-url\t${url}`, 'aria-ignore-bad-url', where, url)
			continue
		}
		if (hub) toProbe.push({ url, where })
	}
	if (!toProbe.length) return

	await Promise.all([...new Set(toProbe.map(item => item.url))].map(url =>
		isClosed(url, { refresh }),
	))

	for (const { url, where } of toProbe) {
		const closed = await isClosed(url)
		const problem = ariaIgnoreProblem({ url, where, closed })
		if (problem?.code !== 'closed') continue
		reporter.report(`aria-ignore-closed\t${url}`, 'aria-ignore-closed', where, url)
	}
}

/**
 * @param {import('https://esm.sh/axe-core').Result} violation axe 违规
 * @param {import('https://esm.sh/axe-core').NodeResult} node 违规节点
 * @returns {string} 去重键
 */
function violationKey(violation, node) {
	const target = Array.isArray(node.target) ? node.target.join(' ') : String(node.target ?? '')
	return `${violation.id}\t${target}\t${node.failureSummary ?? ''}`
}

/**
 * 跑一轮 axe 扫描并打印违规。
 * @param {{ refreshGithubIssues?: boolean }} [options] 是否重查 issue 关闭态
 * @returns {Promise<void>} 扫描完成
 */
async function scan({ refreshGithubIssues = false } = {}) {
	const ariaIgnoreEntries = collectAriaIgnoreEntries()
	await checkAriaIgnores({ refresh: refreshGithubIssues, entries: ariaIgnoreEntries })
	const axeExclude = ariaIgnoreEntries
		.filter(entry => entry.parsed)
		.map(entry => entry.element)
	const results = await axe.run({
		exclude: axeExclude,
	}, {
		resultTypes: ['violations'],
		iframes: false,
		rules: {
			'color-contrast': { enabled: false },
			'link-in-text-block': { enabled: false },
		},
	})
	for (const violation of results.violations)
		for (const node of violation.nodes) {
			const key = violationKey(violation, node)
			reporter.report(
				key,
				violation.id,
				violation.help,
				node.target,
				node.failureSummary || '',
			)
		}
}

/** @type {import('./loop.mjs').WatchTask} */
export const task = { name: 'a11y', delayMs: A11Y_SCAN_MS, run, covered, beginDrain }
