import { ms } from 'fount/scripts/ms.mjs'
import { createFountFixtures } from 'fount/scripts/test/playwright/fixtures.mjs'

/** Codex 模型目录前端 E2E 隔离节点。 */
export const { test, expect } = createFountFixtures({
	locale: 'zh-CN',
	isolated: { shellLabel: 'CodexModelCatalog', timeout: ms('3m') },
})
