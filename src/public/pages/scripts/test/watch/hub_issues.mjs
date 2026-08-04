/**
 * 经测试 hub 探测 GitHub issue 关闭态（cache / backoff / inflight）。
 */
import { testHubBaseUrl } from '../hub_url.mjs'

/** hub 查询有界超时（毫秒）。 */
const GITHUB_ISSUE_FETCH_TIMEOUT_MS = 10_000
/** hub 失败后的退避（毫秒）。 */
const GITHUB_ISSUE_PROBE_BACKOFF_MS = 30_000

/**
 * @typedef {{
 *   isClosed: (url: string, options?: { refresh?: boolean }) => Promise<boolean>,
 *   reset: () => void,
 * }} IssueClosedProbe
 */

/**
 * 创建 issue 关闭态探测器。
 * @returns {IssueClosedProbe} 探测 API
 */
export function createIssueClosedProbe() {
	/** @type {Map<string, boolean>} */
	const closedCache = new Map()
	/** @type {Map<string, Promise<boolean>>} */
	const inflight = new Map()
	/** @type {Map<string, number>} */
	const backoffUntil = new Map()

	/**
	 * 清除缓存与进行中请求。
	 * @returns {void}
	 */
	function reset() {
		closedCache.clear()
		backoffUntil.clear()
		inflight.clear()
	}

	/**
	 * issue 是否已关闭（成功结果缓存；失败退避；无 hub / 超时 → false）。
	 * @param {string} url 已解析的 issue URL
	 * @param {{ refresh?: boolean }} [options] `refresh` 时跳过缓存
	 * @returns {Promise<boolean>} 已关闭为 true
	 */
	async function isClosed(url, { refresh = false } = {}) {
		const hub = testHubBaseUrl()
		if (!hub) return false

		if (refresh) {
			closedCache.delete(url)
			backoffUntil.delete(url)
			const pending = inflight.get(url)
			if (pending) await pending.catch(() => { })
			inflight.delete(url)
		}
		else {
			if (closedCache.has(url)) return closedCache.get(url)
			if ((backoffUntil.get(url) ?? 0) > Date.now()) return false
			const pending = inflight.get(url)
			if (pending) return pending
		}

		const probe = (async () => {
			try {
				const response = await fetch(`${hub}/github-issue?url=${encodeURIComponent(url)}`, {
					signal: AbortSignal.timeout(GITHUB_ISSUE_FETCH_TIMEOUT_MS),
				})
				if (!response.ok) {
					backoffUntil.set(url, Date.now() + GITHUB_ISSUE_PROBE_BACKOFF_MS)
					return false
				}
				const closed = (await response.json())?.closed === true
				closedCache.set(url, closed)
				return closed
			}
			catch {
				backoffUntil.set(url, Date.now() + GITHUB_ISSUE_PROBE_BACKOFF_MS)
				return false
			}
			finally {
				inflight.delete(url)
			}
		})()
		inflight.set(url, probe)
		return probe
	}

	return { isClosed, reset }
}
