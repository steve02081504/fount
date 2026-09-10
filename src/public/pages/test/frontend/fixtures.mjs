import { ms } from 'fount/scripts/ms.mjs'
import { createFountFixtures } from 'fount/scripts/test/playwright/fixtures.mjs'

/** 核心 pages 前端 E2E fixture（隔离节点）。 */
export const { test, expect } = createFountFixtures({
	locale: 'zh-CN',
	isolated: { shellLabel: 'Pages', timeout: ms('3m') },
})
