import { initTranslations, console } from '../../../scripts/i18n.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { showToast } from '../../../scripts/toast.mjs'
import { currentChatId, createNewChat, addCharacter } from '../src/endpoints.mjs'

await initTranslations('chat.new')
applyTheme()

try {
	await createNewChat()
	const searchParams = new URLSearchParams(window.location.search)
	const charToAdd = searchParams.get('char')
	if (charToAdd) await addCharacter(charToAdd)
}
catch (e) {
	console.error(e)
	showToast(e.message || String(e), 'error')
	throw e
}

window.history.replaceState(null, null, '/shells/chat/#' + currentChatId)
window.location = '/shells/chat/#' + currentChatId
window.location.reload()
