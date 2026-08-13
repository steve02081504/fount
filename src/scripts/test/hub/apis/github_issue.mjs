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
 * issue 关闭态缓存（时间戳；队列空时 prune）。
 */
export class GithubIssueCache {
	/** 空缓存。 */
	constructor() {
		/** @type {Map<string, { closed: boolean, at: number }>} */
		this.entries = new Map()
	}

	/**
	 * @param {string} url issue URL
	 * @param {() => Promise<boolean>} probe 探测
	 * @param {() => number} [now] 当前时间
	 * @returns {Promise<boolean>} 已关闭
	 */
	async getClosed(url, probe, now = Date.now) {
		const hit = this.entries.get(url)
		if (hit) return hit.closed
		const closed = await probe()
		this.entries.set(url, { closed, at: now() })
		return closed
	}

	/**
	 * 丢掉缓存时间超过 maxAge 的条目。
	 * @param {number} [maxAgeMs=ISSUE_CACHE_PRUNE_MS] 最大年龄
	 * @param {() => number} [now] 当前时间
	 * @returns {number} 删掉的条数
	 */
	pruneOlderThan(maxAgeMs = ISSUE_CACHE_PRUNE_MS, now = Date.now) {
		const cutoff = now() - maxAgeMs
		let n = 0
		for (const [url, entry] of this.entries)
			if (entry.at < cutoff) {
				this.entries.delete(url)
				n++
			}
		return n
	}
}

/**
 * @param {{ owner: string, repo: string, number: string }} parsed 已解析的 issue
 * @returns {Promise<boolean>} 已关闭为 true；gh 失败视为未关闭
 */
export async function probeGithubIssueClosed(parsed) {
	try {
		const result = await execFile('gh', [
			'issue', 'view', parsed.number,
			'--repo', `${parsed.owner}/${parsed.repo}`,
			'--json', 'state',
		], { signal: AbortSignal.timeout(GH_ISSUE_VIEW_TIMEOUT_MS) })
		if (result.code !== 0) return false
		const raw = String(result.stdout || '').trim()
		if (!raw) return false
		return JSON.parse(raw).state === 'CLOSED'
	}
	catch {
		return false
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
			return res.json({ closed: false })
		const closed = await cache.getClosed(
			issueUrl,
			() => probeGithubIssueClosed(parsed),
		)
		res.json({ closed })
	})

	return router
}
