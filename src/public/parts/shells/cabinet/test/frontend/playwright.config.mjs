import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPlaywrightConfig } from 'fount/scripts/test/playwright/config.mjs'

import { phases } from './phases.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Cabinet 前端 Playwright 配置。
 */
export default await createPlaywrightConfig({
	testDir: __dirname,
	overrides: {
		timeout: 180_000,
		projects: phases.map(p => ({ name: p.name, testMatch: p.testMatch })),
	},
})
