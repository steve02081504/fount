/**
 * `GET /github-issue?url=` — 带时间戳的进程内缓存 + `gh issue view`。
 */
import { execFile } from 'npm:@steve02081504/exec'
import { Router } from 'npm:express'

import { parseGithubIssueUrl } from '../../core/github_issue.mjs'

/** `gh issue view` 有界超时（毫秒）。 */
const GH_ISSUE_VIEW_TIMEOUT_MS = 15_000

/** 队列清空时丢掉超过此时长的缓存。 */
export const ISSUE_CACHE_PRUNE_MS = 60 * 60 * 1000

/**
 * @param {unknown} value gh `closedAt`
 * @returns {number | null} unix ms
 */
function parseClosedAt(value) {
	if (value == null || value === '') return null
	if (typeof value === 'number' && Number.isFinite(value)) return value
	const ms = Date.parse(String(value))
	return Number.isFinite(ms) ? ms : null
}

/**
 * issue 关闭态缓存（时间戳；队列空时 prune）。
 */
export class GithubIssueCache {
	/** 空缓存。 */
	constructor() {
		/** @type {Map<string, { closed: boolean, closedAt: number | null, at: number }>} */
		this.entries = new Map()
	}

	/**
	 * @param {string} url issue URL
	 * @param {() => Promise<import('../../core/skip_because.mjs').IssueClosedState>} probe 探测
	 * @param {() => number} [now] 当前时间
	 * @returns {Promise<import('../../core/skip_because.mjs').IssueClosedState>} 关闭态
	 */
	async getState(url, probe, now = Date.now) {
		const hit = this.entries.get(url)
		if (hit) return { closed: hit.closed, closedAt: hit.closedAt }
		const state = await probe()
		this.entries.set(url, { closed: state.closed, closedAt: state.closedAt, at: now() })
		return { closed: state.closed, closedAt: state.closedAt }
	}

	/**
	 * 丢掉缓存时间超过 maxAge 的条目。
	 * @param {number} [maxAgeMs=ISSUE_CACHE_PRUNE_MS] 最大年龄
	 * @param {() => number} [now] 当前时间
	 * @returns {number} 删掉的条数
	 */
	pruneOlderThan(maxAgeMs = ISSUE_CACHE_PRUNE_MS, now = Date.now) {
		const cutoff = now() - maxAgeMs
		let count = 0
		for (const [url, entry] of this.entries)
			if (entry.at < cutoff) {
				this.entries.delete(url)
				count++
			}
		return count
	}
}

/**
 * @param {{ owner: string, repo: string, number: string }} parsed 已解析的 issue
 * @returns {Promise<import('../../core/skip_because.mjs').IssueClosedState>} gh 失败视为未关闭
 */
export async function probeGithubIssue(parsed) {
	try {
		const result = await execFile('gh', [
			'issue', 'view', parsed.number,
			'--repo', `${parsed.owner}/${parsed.repo}`,
			'--json', 'state,closedAt',
		], { signal: AbortSignal.timeout(GH_ISSUE_VIEW_TIMEOUT_MS) })
		if (result.code !== 0) return { closed: false, closedAt: null }
		const raw = String(result.stdout || '').trim()
		if (!raw) return { closed: false, closedAt: null }
		const data = JSON.parse(raw)
		const closed = data.state === 'CLOSED'
		return {
			closed,
			closedAt: closed ? parseClosedAt(data.closedAt) : null,
		}
	}
	catch {
		return { closed: false, closedAt: null }
	}
}

/**
 * @param {GithubIssueCache} [cache] 缓存；省略则新建
 * @returns {import('npm:express').Router} 路由
 */
export function createGithubIssueRouter(cache = new GithubIssueCache()) {
	const router = Router()

	router.get('/github-issue', async (req, res) => {
		const issueUrl = String(req.query.url || '').trim()
		const parsed = parseGithubIssueUrl(issueUrl)
		if (!parsed)
			return res.json({ closed: false, closedAt: null })
		const state = await cache.getState(
			issueUrl,
			() => probeGithubIssue(parsed),
		)
		res.json(state)
	})

	return router
}
