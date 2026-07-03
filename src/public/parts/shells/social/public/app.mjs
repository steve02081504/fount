/**
 * Social shell 前端入口。
 */
import { usingTemplates } from '../../../scripts/features/template.mjs'
import { geti18n, initTranslations } from '../../../scripts/i18n/index.mjs'
import { applyTheme } from '../../../scripts/theme/index.mjs'

import { createSocialContext } from './src/createContext.mjs'
import { bootstrapSocialApp } from './src/init.mjs'

applyTheme()
usingTemplates('/parts/shells:social/src/templates')
await initTranslations('social')

const appContext = createSocialContext(geti18n)
await bootstrapSocialApp(appContext)
