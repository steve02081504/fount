/**
 * `[aria-ignore]` 策略：属性名、DOM 采集、缺 URL / 坏 URL / 已关闭判定。
 * 纯判定可被 Deno（经 core re-export）与页内 watch 共用。
 */
import { parseGithubIssueUrl } from './github_issue.mjs'

/** HTML 属性名：值须为跟踪上游修复的 GitHub issue URL。 */
export const ARIA_IGNORE_ATTR = 'aria-ignore'

/**
 * @typedef {{ url: string, where: string, element?: Element, parsed: ReturnType<typeof parseGithubIssueUrl> }} AriaIgnoreEntry
 */

/**
 * @typedef {'missing-url' | 'bad-url' | 'closed'} AriaIgnoreProblemCode
 */

/**
 * @typedef {{ code: AriaIgnoreProblemCode, message: string }} AriaIgnoreProblem
 */

/**
 * 收集页面 `[aria-ignore]` 节点（浏览器 DOM）。
 * @returns {AriaIgnoreEntry[]} 节点列表
 */
export function collectAriaIgnoreEntries() {
	/** @type {AriaIgnoreEntry[]} */
	const entries = []
	for (const element of document.querySelectorAll(`[${ARIA_IGNORE_ATTR}]`)) {
		const url = (element.getAttribute(ARIA_IGNORE_ATTR) || '').trim()
		const where = element.id ? `#${element.id}` : element.className || element.tagName
		entries.push({
			url,
			where: String(where),
			element,
			parsed: url ? parseGithubIssueUrl(url) : null,
		})
	}
	return entries
}

/**
 * 判定单条 aria-ignore 是否有问题。
 * `closed` 由调用方探测后传入；未探测时勿传 `true`。
 * @param {{ url: string, where: string, closed?: boolean }} entry 条目
 * @returns {AriaIgnoreProblem | null} 问题；无则为 null
 */
export function ariaIgnoreProblem({ url, where, closed = false }) {
	if (!url)
		return { code: 'missing-url', message: `${where}: aria-ignore requires a GitHub issue URL` }
	if (!parseGithubIssueUrl(url))
		return { code: 'bad-url', message: `${where}: bad aria-ignore URL ${url}` }
	if (closed)
		return { code: 'closed', message: `${where}: issue closed — remove aria-ignore (${url})` }
	return null
}
