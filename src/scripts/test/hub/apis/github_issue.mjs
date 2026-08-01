/**
 * `GET /github-issue?url=` — 本进程缓存 + `gh issue view`。
 */
import { Router } from 'npm:express'
import { execFile } from 'npm:@steve02081504/exec'

import { parseGithubIssueUrl } from '../../core/github_issue.mjs'

/**
 * @param {string} url GitHub issue URL
 * @returns {Promise<boolean>} 已关闭为 true；gh 失败视为未关闭
 */
async function probeGithubIssueClosed(url) {
	const parsed = parseGithubIssueUrl(url)
	if (!parsed) return false
	try {
		const result = await execFile('gh', [
			'issue', 'view', parsed.number,
			'--repo', `${parsed.owner}/${parsed.repo}`,
			'--json', 'state',
		])
		if (result.code !== 0) return false
		const raw = (result.stdout ?? result.stdall ?? '').trim()
		if (!raw) return false
		const data = JSON.parse(raw)
		return String(data.state || '').toUpperCase() === 'CLOSED'
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
		if (!parseGithubIssueUrl(issueUrl))
			return res.json({ closed: false })
		if (!closedCache.has(issueUrl))
			closedCache.set(issueUrl, await probeGithubIssueClosed(issueUrl))
		res.json({ closed: closedCache.get(issueUrl) === true })
	})

	return router
}
