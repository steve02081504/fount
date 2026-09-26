import { createPhasedPlaywrightConfig } from 'fount/scripts/test/playwright/config.mjs'

import { phases } from './phases.mjs'

/** Codex 服务源设置页的 Playwright 配置。 */
export default await createPhasedPlaywrightConfig(import.meta.url, phases, { timeout: 120_000 })
