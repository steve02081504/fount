/**
 * `GET /github-issue?url=` — 本进程缓存 + `gh issue view`。
 */
import { execFile } from 'npm:@steve02081504/exec'
import { Router } from 'npm:express'

import { parseGithubIssueUrl } from '../../core/github_issue.mjs'

/** `gh issue view` 有界超时（毫秒）。 */
const GH_ISSUE_VIEW_TIMEOUT_MS = 15_000

/**
 * @param {{ owner: string, repo: string, number: string }} parsed 已解析的 issue
 * @returns {Promise<boolean>} 已关闭为 true；gh 失败视为未关闭
 */
async function probeGithubIssueClosed(parsed) {
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
 * @returns {import('npm:express').Router} 路由
 */
export function createGithubIssueRouter() {
	/** @type {Map<string, boolean>} */
	const closedCache = new Map()
	const router = Router()

	router.get('/github-issue', async (req, res) => {
		const issueUrl = String(req.query.url || '').trim()
		const parsed = parseGithubIssueUrl(issueUrl)
		if (!parsed)
			return res.json({ closed: false })
		if (!closedCache.has(issueUrl))
			closedCache.set(issueUrl, await probeGithubIssueClosed(parsed))
		res.json({ closed: closedCache.get(issueUrl) })
	})

	return router
}
