/**
 * Playwright 收尾：断言页面 `[aria-ignore]` 仍指向未关闭的 GitHub issue。
 * 关闭态经测试 hub（`FOUNT_TEST_HUB_URL`）查询；无 hub / 探测失败 → 视为仍打开。
 */
import { parseGithubIssueUrl } from '../core/github_issue.mjs'
import { isGithubIssueClosed } from '../hub/clients/github_issue.mjs'

export { isGithubIssueClosed }

/**
 * 收集页面 `[aria-ignore]`，缺 URL / 非 issue URL / issue 已关闭则抛错。
 * @param {import('@playwright/test').Page} page 页面
 * @returns {Promise<void>}
 */
export async function assertAriaIgnoreIssues(page) {
	const entries = await page.evaluate(() => [...document.querySelectorAll('[aria-ignore]')].map(el => ({
		url: (el.getAttribute('aria-ignore') || '').trim(),
		where: el.id ? `#${el.id}` : String(el.className || el.tagName),
	})))
	if (!entries.length) return

	/** @type {string[]} */
	const problems = []
	for (const { url, where } of entries) {
		if (!url) {
			problems.push(`${where}: aria-ignore requires a GitHub issue URL`)
			continue
		}
		if (!parseGithubIssueUrl(url)) {
			problems.push(`${where}: bad aria-ignore URL ${url}`)
			continue
		}
		if (await isGithubIssueClosed(url))
			problems.push(`${where}: issue closed — remove aria-ignore (${url})`)
	}
	if (problems.length)
		throw new Error(`aria-ignore:\n${problems.join('\n')}`)
}
