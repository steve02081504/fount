import { ms } from 'fount/scripts/ms.mjs'
import { createFountFixtures } from 'fount/scripts/test/playwright/fixtures.mjs'

/**
 * DebugInfo 前端 E2E fixture（隔离节点）。
 * 用例断言「自动更新关闭」时 `/restart` 的 403 提示与版本比较取不到远端时的失败徽标，
 * 两者的错误响应都是预期内的失败，不计噪声。其它网络错误必须暴露出来。
 */
export const { test, expect } = createFountFixtures({
	locale: 'zh-CN',
	isolated: { shellLabel: 'DebugInfo', timeout: ms('3m') },
	/**
	 * 判定网络噪声是否属于本套件预期内的失败。
	 * @param {{ kind: string, status?: number|null, url?: string }} entry 网络条目
	 * @returns {boolean} 是否豁免
	 */
	shouldIgnoreNetwork: entry => {
		if (entry.kind !== 'http' || !entry.url) return false
		const pathname = new URL(entry.url).pathname
		return entry.status === 403 && pathname.endsWith('/api/parts/shells:debug_info/restart')
			|| entry.status === 404 && pathname.startsWith('/repos/steve02081504/fount/compare/')
	},
})
