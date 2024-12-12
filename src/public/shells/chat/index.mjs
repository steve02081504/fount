import { applyTheme } from '../../scripts/theme.mjs'
import { initializeChat } from './src/public/chat.mjs'
import { initializeFileHandling } from './src/public/fileHandling.mjs'
import { initializeMessageInput } from './src/public/ui/messageInput.mjs'

async function init() {
	applyTheme()
	await initializeChat()
	initializeFileHandling()
	initializeMessageInput()
}

init()
