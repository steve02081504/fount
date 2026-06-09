/**
 * Social shell 前端入口。
 */
import { geti18n, initTranslations } from '../../../../pages/scripts/i18n.mjs'
import { usingTemplates } from '../../../../pages/scripts/template.mjs'
import { applyTheme } from '../../../../pages/scripts/theme.mjs'

import { createSocialContext } from './src/createContext.mjs'
import { bootstrapSocialApp } from './src/init.mjs'

applyTheme()
usingTemplates('/parts/shells:social/public/src/templates')
await initTranslations('social')

const appContext = createSocialContext(geti18n)
await bootstrapSocialApp(appContext)
