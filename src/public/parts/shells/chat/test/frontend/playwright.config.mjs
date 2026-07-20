import { createPhasedPlaywrightConfig } from 'fount/scripts/test/playwright/config.mjs'

import { phases } from './phases.mjs'

/**
 * Chat 前端 Playwright 多阶段配置。
 */
export default await createPhasedPlaywrightConfig(import.meta.url, phases)
