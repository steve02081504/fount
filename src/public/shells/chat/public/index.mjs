import { initTranslations } from '../../scripts/i18n.mjs'
import { usingTemplates } from '../../scripts/template.mjs'
import { applyTheme } from '../../scripts/theme.mjs'

import { initializeChat } from './src/chat.mjs'
import { initializeMessageInput } from './src/ui/messageInput.mjs'

async function init() {
	applyTheme()
	await initTranslations('chat')
	usingTemplates('/shells/chat/src/templates')
	await initializeChat()
	initializeMessageInput()
}

init()
