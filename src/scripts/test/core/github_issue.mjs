/**
 * GitHub issue URL 解析（纯函数，Deno / Node 皆可）。
 */

/**
 * 解析 `https://github.com/{owner}/{repo}/issues/{n}`。
 * @param {string} url issue URL
 * @returns {{ owner: string, repo: string, number: string } | null} 解析结果
 */
export function parseGithubIssueUrl(url) {
	try {
		const parsed = new URL(String(url || '').trim())
		if (parsed.hostname !== 'github.com') return null
		const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/)
		if (!match) return null
		return { owner: match[1], repo: match[2], number: match[3] }
	}
	catch {
		return null
	}
}
