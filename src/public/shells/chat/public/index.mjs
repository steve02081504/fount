import { initTranslations } from '../../scripts/i18n.mjs'
import { usingTemplates } from '../../scripts/template.mjs'
import { applyTheme } from '../../scripts/theme.mjs'

import { initializeChat } from './src/chat.mjs'

async function init() {
	applyTheme()
	await initTranslations('chat')
	usingTemplates('/shells/chat/src/templates')
	await initializeChat()
}

init()
