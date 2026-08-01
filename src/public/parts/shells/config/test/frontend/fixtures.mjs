import { ms } from 'fount/scripts/ms.mjs'
import { createFountFixtures } from 'fount/scripts/test/playwright/fixtures.mjs'

/** Config 前端 E2E fixture（隔离节点）。 */
export const { test, expect } = createFountFixtures({
	locale: 'zh-CN',
	isolated: { shellLabel: 'Config', timeout: ms('3m') },
})
