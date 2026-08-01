/**
 * GitHub issue URL 解析（浏览器 / Deno 共用）。
 */

/**
 * 解析 `https://github.com/{owner}/{repo}/issues/{n}`。
 * @param {string} url issue URL
 * @returns {{ owner: string, repo: string, number: string } | null} 解析结果
 */
export function parseGithubIssueUrl(url) {
	const match = String(url).match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/)
	if (!match) return null
	return { owner: match[1], repo: match[2], number: match[3] }
}
