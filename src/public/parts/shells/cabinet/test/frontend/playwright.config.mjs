import { createPhasedPlaywrightConfig } from 'fount/scripts/test/playwright/config.mjs'

import { phases } from './phases.mjs'

/**
 * Cabinet 前端 Playwright 配置。
 */
export default await createPhasedPlaywrightConfig(import.meta.url, phases, { timeout: 180_000 })
