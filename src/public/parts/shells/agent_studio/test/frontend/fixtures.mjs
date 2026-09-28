import { ms } from 'fount/scripts/ms.mjs'
import { createFountFixtures } from 'fount/scripts/test/playwright/fixtures.mjs'

/** Agent Studio 前端 E2E fixture（隔离节点）。 */
export const { test, expect } = createFountFixtures({
	locale: 'zh-CN',
	isolated: { shellLabel: 'AgentStudio', timeout: ms('3m') },
	/**
	 * 用例以未知 id 深链验证视图优雅降级，子代理 / 会话详情的 404 属预期失败，不计噪声。
	 * @param {{ kind: string, status?: number|null, url?: string }} entry 网络条目
	 * @returns {boolean} 是否豁免
	 */
	shouldIgnoreNetwork: entry => {
		if (entry.kind !== 'http' || entry.status !== 404 || !entry.url) return false
		const { pathname } = new URL(entry.url)
		return pathname.includes('/api/parts/shells:agent_studio/subagent/')
			|| pathname.includes('/api/parts/shells:agent_studio/conversation/')
	},
})
