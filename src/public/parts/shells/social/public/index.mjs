/**
 * Social shell 前端入口。
 */
import { initTranslations } from '../../../scripts/i18n/index.mjs'
import { applyTheme } from '../../../scripts/theme/index.mjs'

import { bootstrap } from './src/init.mjs'

applyTheme()
await initTranslations('social')
await bootstrap()
