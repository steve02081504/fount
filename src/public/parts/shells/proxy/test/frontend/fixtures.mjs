import { ms } from 'fount/scripts/ms.mjs'
import { createFountFixtures } from 'fount/scripts/test/playwright/fixtures.mjs'

/** Proxy 前端 E2E fixture（隔离节点）。 */
export const { test, expect } = createFountFixtures({
	locale: 'zh-CN',
	isolated: { shellLabel: 'Proxy', timeout: ms('3m') },
})
