import { applyTheme } from '../../scripts/theme.mjs'
import { initializeChat } from './src/public/chat.mjs'
import { initializeMessageInput } from './src/public/ui/messageInput.mjs'
import { initTranslations } from '../../scripts/i18n.mjs' // Import i18n functions

async function init() {
	applyTheme()
	initTranslations('chat') // Initialize translations for 'chat'
	await initializeChat()
	initializeMessageInput()
}

init()
