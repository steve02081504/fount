import { ms } from 'fount/scripts/ms.mjs'
import { createFountFixtures } from 'fount/scripts/test/playwright/fixtures.mjs'

/** DebugInfo 前端 E2E fixture（隔离节点）。 */
export const { test, expect } = createFountFixtures({
	locale: 'zh-CN',
	isolated: { shellLabel: 'DebugInfo', timeout: ms('3m') },
	/**
	 * 用例断言「自动更新关闭」时 `/restart` 的 403 提示，该 403 属预期失败，不计噪声。
	 * @param {{ kind: string, status?: number|null, url?: string }} entry 网络条目
	 * @returns {boolean} 是否豁免
	 */
	shouldIgnoreNetwork: entry => entry.kind === 'http' && entry.status === 403 && !!entry.url
		&& new URL(entry.url).pathname.endsWith('/api/parts/shells:debug_info/restart'),
})
