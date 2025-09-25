import { initTranslations, console } from '../../../scripts/i18n.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { showToast } from '../../../scripts/toast.mjs'
import { currentChatId, createNewChat, addCharacter } from '../src/endpoints.mjs'
import { initializeWebSocket } from '../src/websocket.mjs'

await initTranslations('chat.new')
applyTheme()

function logger(e) {
	console.error(e)
	showToast(e.message || String(e), 'error')
}

try {
	await createNewChat() // Sets currentChatId

	// Initialize WebSocket connection on the new page
	initializeWebSocket()

	const searchParams = new URLSearchParams(window.location.search)
	const charToAdd = searchParams.get('char')

	if (charToAdd) 
		// Add character directly on this page after WebSocket is initialized
		await addCharacter(charToAdd)
	

	// Redirect to the main chat page without the 'char' query parameter
	window.location.href = `/shells/chat/#${currentChatId}`
} catch (e) {
	logger(e)
}
