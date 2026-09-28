import { ms } from 'fount/scripts/ms.mjs'
import { createFountFixtures } from 'fount/scripts/test/playwright/fixtures.mjs'

/** Codex 模型目录前端 E2E 隔离节点。 */
export const { test, expect } = createFountFixtures({
	locale: 'zh-CN',
	isolated: { shellLabel: 'CodexModelCatalog', timeout: ms('3m') },
	/**
	 * 用例断言目录请求 503 时页面显示错误并保留旧模型，该 503 是按需 mock 的预期失败。
	 * @param {{ kind: string, status?: number|null, url?: string }} entry 网络条目
	 * @returns {boolean} 是否豁免
	 */
	shouldIgnoreNetwork: entry => entry.kind === 'http' && entry.status === 503 && !!entry.url
		&& new URL(entry.url).pathname.endsWith('/api/parts/serviceGenerators:AI:codex/models'),
})
