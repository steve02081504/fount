/**
 * axe-core 无障碍扫描 + `[aria-ignore]` 校验（含 hub issue 关闭态）。
 */
import axe from 'https://esm.sh/axe-core'

import { parseGithubIssueUrl } from '../github_issue.mjs'

/**
 * 第三方 / 暂不可修子树：axe `exclude`。
 * 属性值必须是跟踪上游修复的 GitHub issue URL（`aria-ignore="https://github.com/…/issues/n"`）。
 */
export const ARIA_IGNORE = 'aria-ignore'

/** hub 查询有界超时（毫秒）。 */
const GITHUB_ISSUE_FETCH_TIMEOUT_MS = 10_000
/** hub 失败后的退避（毫秒）。 */
const GITHUB_ISSUE_PROBE_BACKOFF_MS = 30_000

const A11Y_PREFIX = '[test:a11y]'
/** DOM 仍在变时的扫描间隔 */
export const A11Y_SCAN_MS = 500

/**
 * @typedef {{ url: string, location: string, element: Element, parsed: ReturnType<typeof parseGithubIssueUrl> }} AriaIgnoreEntry
 */

/**
 * a11y watch 任务：脏扫描 + drain 时强制带 issue 刷新的一轮。
 */
export class A11yWatch {
	#dirty = false
	#needRefresh = false
	#drainPassDone = false
	/** @type {Set<string>} */
	#printedKeys
	/** @type {() => boolean} */
	#isReady
	/** @type {() => void} */
	#wake
	/** @type {Map<string, boolean>} */
	#issueClosedCache = new Map()
	/** @type {Map<string, Promise<boolean>>} */
	#issueInflight = new Map()
	/** @type {Map<string, number>} */
	#issueBackoffUntil = new Map()

	/**
	 * @param {object} options 依赖
	 * @param {Set<string>} options.printedKeys 违规指纹去重
	 * @param {() => boolean} options.isReady locale 闸是否已开
	 * @param {() => void} options.wake 唤醒 loop
	 */
	constructor({ printedKeys, isReady, wake }) {
		this.#printedKeys = printedKeys
		this.#isReady = isReady
		this.#wake = wake
	}

	/**
	 * 注册到 {@link import('./watch_loop.mjs').WatchLoop} 的任务描述。
	 * @returns {import('./watch_loop.mjs').WatchTask} 任务
	 */
	createTask() {
		return {
			name: 'a11y',
			delayMs: A11Y_SCAN_MS,
			run: this.runTask.bind(this),
			covered: this.isCovered.bind(this),
			beginDrain: this.beginDrain.bind(this),
		}
	}

	/**
	 * WatchLoop 回调：跑一轮或空转。
	 * @param {import('./watch_loop.mjs').WatchTickContext} ctx tick 上下文
	 * @returns {Promise<boolean>} true = 空转
	 */
	runTask(ctx) {
		return this.#run(ctx)
	}

	/**
	 * drain 覆盖是否完成。
	 * @returns {boolean} 本轮 drain a11y 已跑完则为 true
	 */
	isCovered() {
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
	 * DOM 变脏。
	 * @param {{ wake?: boolean }} [options] `wake: false` 仅记脏位（开闸前）
	 * @returns {void}
	 */
	markDirty({ wake = true } = {}) {
		this.#dirty = true
		if (wake) this.#wake()
	}

	/**
	 * 要求下一轮带 issue 刷新的扫描（kickWatch）。
	 * @returns {void}
	 */
	requestRefresh() {
		this.#needRefresh = true
		this.#dirty = true
		this.refreshGithubIssueProbes()
		this.#wake()
	}

	/**
	 * 清除 GitHub issue 关闭态探测缓存。
	 * @returns {void}
	 */
	refreshGithubIssueProbes() {
		this.#issueClosedCache.clear()
		this.#issueBackoffUntil.clear()
		this.#issueInflight.clear()
	}

	/**
	 * @param {import('./watch_loop.mjs').WatchTickContext} ctx tick 上下文
	 * @returns {Promise<boolean>} true = 空转
	 */
	async #run({ draining }) {
		const refresh = this.#needRefresh || (draining && !this.#drainPassDone)
		if (!refresh && !this.#dirty) return true
		if (!this.#isReady()) return true
		this.#needRefresh = false
		this.#dirty = false
		try {
			await this.#scan({ refreshGithubIssues: refresh })
		}
		finally {
			if (draining) this.#drainPassDone = true
		}
		return false
	}

	/**
	 * 收集页面 `[aria-ignore]` 节点。
	 * @returns {AriaIgnoreEntry[]} 节点列表
	 */
	#collectAriaIgnoreEntries() {
		/** @type {AriaIgnoreEntry[]} */
		const entries = []
		for (const element of document.querySelectorAll(`[${ARIA_IGNORE}]`)) {
			const url = (element.getAttribute(ARIA_IGNORE) || '').trim()
			const location = element.id ? `#${element.id}` : element.className || element.tagName
			entries.push({
				url,
				location,
				element,
				parsed: url ? parseGithubIssueUrl(url) : null,
			})
		}
		return entries
	}

	/**
	 * 规范化 hub 基址。
	 * @returns {string} hub URL；未设则为空串
	 */
	#getHubUrl() {
		return String(globalThis.fount?.test?.hubUrl || '').replace(/\/$/, '')
	}

	/**
	 * issue 是否已关闭（成功结果缓存；失败退避；无 hub / 超时 → false）。
	 * @param {string} url 已解析的 issue URL
	 * @param {{ refresh?: boolean }} [options] `refresh` 时跳过缓存
	 * @returns {Promise<boolean>} 已关闭为 true
	 */
	async #probeGithubIssueClosed(url, { refresh = false } = {}) {
		const hub = this.#getHubUrl()
		if (!hub) return false

		if (refresh) {
			this.#issueClosedCache.delete(url)
			this.#issueBackoffUntil.delete(url)
			const inflight = this.#issueInflight.get(url)
			if (inflight) await inflight.catch(() => { })
			this.#issueInflight.delete(url)
		}
		else {
			if (this.#issueClosedCache.has(url)) return this.#issueClosedCache.get(url)
			if ((this.#issueBackoffUntil.get(url) ?? 0) > Date.now()) return false
			const inflight = this.#issueInflight.get(url)
			if (inflight) return inflight
		}

		const probe = (async () => {
			try {
				const response = await fetch(`${hub}/github-issue?url=${encodeURIComponent(url)}`, {
					signal: AbortSignal.timeout(GITHUB_ISSUE_FETCH_TIMEOUT_MS),
				})
				if (!response.ok) {
					this.#issueBackoffUntil.set(url, Date.now() + GITHUB_ISSUE_PROBE_BACKOFF_MS)
					return false
				}
				const closed = (await response.json())?.closed === true
				this.#issueClosedCache.set(url, closed)
				return closed
			}
			catch {
				this.#issueBackoffUntil.set(url, Date.now() + GITHUB_ISSUE_PROBE_BACKOFF_MS)
				return false
			}
			finally {
				this.#issueInflight.delete(url)
			}
		})()
		this.#issueInflight.set(url, probe)
		return probe
	}

	/**
	 * 校验 `[aria-ignore]` 格式与关闭态。
	 * @param {{ refresh?: boolean, entries?: AriaIgnoreEntry[] }} [options] 选项
	 * @returns {Promise<void>} 校验完成
	 */
	async #checkAriaIgnores({ refresh = false, entries = this.#collectAriaIgnoreEntries() } = {}) {
		const hub = this.#getHubUrl()
		/** @type {{ url: string, location: string }[]} */
		const toProbe = []
		for (const { url, location, parsed } of entries) {
			if (!url) {
				const key = `aria-ignore-missing\t${location}`
				if (this.#printedKeys.has(key)) continue
				this.#printedKeys.add(key)
				console.error(A11Y_PREFIX, 'aria-ignore-missing-url', location, 'aria-ignore requires a GitHub issue URL')
				continue
			}
			if (!parsed) {
				const key = `aria-ignore-bad-url\t${url}`
				if (this.#printedKeys.has(key)) continue
				this.#printedKeys.add(key)
				console.error(A11Y_PREFIX, 'aria-ignore-bad-url', location, url)
				continue
			}
			if (hub) toProbe.push({ url, location })
		}
		if (!toProbe.length) return

		await Promise.all([...new Set(toProbe.map(item => item.url))].map(url =>
			this.#probeGithubIssueClosed(url, { refresh }),
		))

		for (const { url, location } of toProbe) {
			if (this.#issueClosedCache.get(url) !== true) continue
			const key = `aria-ignore-closed\t${url}`
			if (this.#printedKeys.has(key)) continue
			this.#printedKeys.add(key)
			console.error(A11Y_PREFIX, 'aria-ignore-closed', location, url)
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
		const ariaIgnoreEntries = this.#collectAriaIgnoreEntries()
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
				if (this.#printedKeys.has(key)) continue
				this.#printedKeys.add(key)
				console.error(
					A11Y_PREFIX,
					violation.id,
					violation.help,
					node.target,
					node.failureSummary || '',
				)
			}

		globalThis.fount.test.watchLastRun = Date.now()
	}
}
