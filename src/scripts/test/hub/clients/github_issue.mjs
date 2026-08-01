/**
 * GitHub issue 关闭态客户端（经 hub `GET /github-issue`）。
 */
import { getTestHubBaseUrl } from '../base_url.mjs'

/** hub 查询有界超时（毫秒）。 */
const GITHUB_ISSUE_FETCH_TIMEOUT_MS = 10_000

/**
 * issue 是否已关闭（无 hub / 失败 / 超时 → false）。
 * @param {string} issueUrl GitHub issue URL
 * @returns {Promise<boolean>} 已关闭为 true
 */
export async function isGithubIssueClosed(issueUrl) {
	const base = getTestHubBaseUrl()
	const url = String(issueUrl || '').trim()
	if (!base || !url) return false
	try {
		const res = await fetch(`${base}/github-issue?url=${encodeURIComponent(url)}`, {
			signal: AbortSignal.timeout(GITHUB_ISSUE_FETCH_TIMEOUT_MS),
		})
		if (!res.ok) return false
		const data = await res.json()
		return data?.closed === true
	}
	catch {
		return false
	}
}
