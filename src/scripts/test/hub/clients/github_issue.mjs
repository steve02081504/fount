/**
 * GitHub issue 关闭态客户端（经 hub `GET /github-issue`）。
 */
import { getTestHubBaseUrl } from '../base_url.mjs'

/**
 * issue 是否已关闭（无 hub / 失败 → false）。
 * @param {string} issueUrl GitHub issue URL
 * @returns {Promise<boolean>} 已关闭为 true
 */
export async function isGithubIssueClosed(issueUrl) {
	const base = getTestHubBaseUrl()
	const url = String(issueUrl || '').trim()
	if (!base || !url) return false
	try {
		const res = await fetch(`${base}/github-issue?url=${encodeURIComponent(url)}`)
		if (!res.ok) return false
		const data = await res.json()
		return data?.closed === true
	}
	catch {
		return false
	}
}
