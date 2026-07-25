import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPlaywrightConfig } from 'fount/scripts/test/playwright/config.mjs'

/**
 * GitHub Pages 前端 Playwright 配置。
 */
export default await createPlaywrightConfig({
	testDir: dirname(fileURLToPath(import.meta.url)),
})
