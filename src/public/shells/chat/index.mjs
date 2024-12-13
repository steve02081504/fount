import { applyTheme } from '../../scripts/theme.mjs'
import { initializeChat } from './src/public/chat.mjs'
import { initializeMessageInput } from './src/public/ui/messageInput.mjs'

async function init() {
	applyTheme()
	await initializeChat()
	initializeMessageInput()
}

init()
