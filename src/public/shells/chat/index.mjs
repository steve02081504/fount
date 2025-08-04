import { applyTheme } from '../../scripts/theme.mjs'
import { initializeChat } from './src/public/chat.mjs'
import { initializeMessageInput } from './src/public/ui/messageInput.mjs'
import { initTranslations } from '../../scripts/i18n.mjs'
import { usingTemplates } from '../../scripts/template.mjs'

async function init() {
	applyTheme()
	initTranslations('chat') // Initialize translations for 'chat'
	usingTemplates('/shells/chat/src/public/templates')
	await initializeChat()
	initializeMessageInput()
}

init()
