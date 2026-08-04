/**
 * axe-core 无障碍扫描；`[aria-ignore]` 校验委托共享策略 + hub 探测。
 */
import axe from 'https://esm.sh/axe-core'

import { ariaIgnoreProblem, collectAriaIgnoreEntries } from '../aria_ignore.mjs'
import { testHubBaseUrl } from '../hub_url.mjs'

import { createIssueClosedProbe } from './hub_issues.mjs'

/** DOM 仍在变时的扫描间隔 */
const A11Y_SCAN_MS = 500

/**
 * a11y watch 任务：脏扫描 + drain 时强制带 issue 刷新的一轮。
 * 直接实现 WatchTask 接口。
 */
export class A11yWatch {
	name = 'a11y'
	delayMs = A11Y_SCAN_MS

	#dirty = false
	#needRefresh = false
	#drainPassDone = false
	/** @type {import('./reporter.mjs').WatchReporter} */
	#reporter
	/** @type {() => void} */
	#wake
	/** @type {import('./hub_issues.mjs').IssueClosedProbe} */
	#issues
	/** @type {(() => void)[]} */
	#refreshWaiters = []
	/** 最近一次扫描完成时间戳（毫秒）；供调试 */
	lastScanAt = 0

	/**
	 * @param {object} options 依赖
	 * @param {import('./reporter.mjs').WatchReporter} options.reporter 去重上报
	 * @param {() => void} options.wake 唤醒 loop
	 */
	constructor({ reporter, wake }) {
		this.#reporter = reporter
		this.#wake = wake
		this.#issues = createIssueClosedProbe()
	}

	/**
	 * drain 覆盖是否完成。
	 * @returns {boolean} 本轮 drain a11y 已跑完则为 true
	 */
	covered() {
		return this.#drainPassDone
	}

	/**
	 * drain 开始：重置覆盖并要求带刷新的扫描。
	 * @returns {void}
	 */
	beginDrain() {
		this.#drainPassDone = false
		this.#needRefresh = true
		this.#dirty = true
	}

	/**
	 * DOM 变脏并唤醒。
	 * @returns {void}
	 */
	markDirty() {
		this.#dirty = true
		this.#wake()
	}

	/**
	 * 要求下一轮带 issue 刷新的扫描；扫完后 resolve。
	 * @returns {Promise<void>}
	 */
	requestRefresh() {
		this.#needRefresh = true
		this.#dirty = true
		this.#issues.reset()
		this.#wake()
		return new Promise(resolve => this.#refreshWaiters.push(resolve))
	}

	/**
	 * WatchLoop 回调：跑一轮或空转。
	 * @param {import('./loop.mjs').WatchTickContext} ctx tick 上下文
	 * @returns {Promise<boolean>} true = 空转
	 */
	async run({ draining }) {
		const refresh = this.#needRefresh || (draining && !this.#drainPassDone)
		if (!refresh && !this.#dirty) return true
		this.#needRefresh = false
		this.#dirty = false
		try {
			await this.#scan({ refreshGithubIssues: refresh })
		}
		finally {
			this.lastScanAt = Date.now()
			for (const resolve of this.#refreshWaiters.splice(0)) resolve()
			if (draining) this.#drainPassDone = true
		}
		return false
	}

	/**
	 * 校验 `[aria-ignore]` 格式与关闭态。
	 * @param {{ refresh?: boolean, entries?: import('../aria_ignore.mjs').AriaIgnoreEntry[] }} [options] 选项
	 * @returns {Promise<void>} 校验完成
	 */
	async #checkAriaIgnores({ refresh = false, entries = collectAriaIgnoreEntries() } = {}) {
		const hub = testHubBaseUrl()
		/** @type {{ url: string, where: string }[]} */
		const toProbe = []
		for (const { url, where, parsed } of entries) {
			const staticProblem = ariaIgnoreProblem({ url, where, closed: false })
			if (staticProblem?.code === 'missing-url') {
				this.#reporter.report(`aria-ignore-missing\t${where}`, 'aria-ignore-missing-url', where, staticProblem.message)
				continue
			}
			if (staticProblem?.code === 'bad-url' || !parsed) {
				this.#reporter.report(`aria-ignore-bad-url\t${url}`, 'aria-ignore-bad-url', where, url)
				continue
			}
			if (hub) toProbe.push({ url, where })
		}
		if (!toProbe.length) return

		await Promise.all([...new Set(toProbe.map(item => item.url))].map(url =>
			this.#issues.isClosed(url, { refresh }),
		))

		for (const { url, where } of toProbe) {
			const closed = await this.#issues.isClosed(url)
			const problem = ariaIgnoreProblem({ url, where, closed })
			if (problem?.code !== 'closed') continue
			this.#reporter.report(`aria-ignore-closed\t${url}`, 'aria-ignore-closed', where, url)
		}
	}

	/**
	 * @param {import('https://esm.sh/axe-core').Result} violation axe 违规
	 * @param {import('https://esm.sh/axe-core').NodeResult} node 违规节点
	 * @returns {string} 去重键
	 */
	#violationKey(violation, node) {
		const target = Array.isArray(node.target) ? node.target.join(' ') : String(node.target ?? '')
		return `${violation.id}\t${target}\t${node.failureSummary ?? ''}`
	}

	/**
	 * 跑一轮 axe 扫描并打印违规。
	 * @param {{ refreshGithubIssues?: boolean }} [options] 是否重查 issue 关闭态
	 * @returns {Promise<void>} 扫描完成
	 */
	async #scan({ refreshGithubIssues = false } = {}) {
		const ariaIgnoreEntries = collectAriaIgnoreEntries()
		await this.#checkAriaIgnores({ refresh: refreshGithubIssues, entries: ariaIgnoreEntries })
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
				const key = this.#violationKey(violation, node)
				this.#reporter.report(
					key,
					violation.id,
					violation.help,
					node.target,
					node.failureSummary || '',
				)
			}
	}
}
