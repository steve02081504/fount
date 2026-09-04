import { createPhasedPlaywrightConfig } from 'fount/scripts/test/playwright/config.mjs'

import { phases } from './phases.mjs'

/**
 * code shell 前端 Playwright 配置。
 */
export default await createPhasedPlaywrightConfig(import.meta.url, phases, { timeout: 120_000 })
