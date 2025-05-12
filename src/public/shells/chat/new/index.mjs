import { initTranslations } from '../../../scripts/i18n.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { currentChatId, addCharacter, createNewChat } from '../src/public/endpoints.mjs'
initTranslations('chat.new')
applyTheme()

function logger(e) {
	console.error(e)
	alert(e)
	throw e
}

await createNewChat().catch(logger)

const serchParams = new URLSearchParams(window.location.search)

if (serchParams.has('char'))
	await addCharacter(serchParams.get('char')).catch(logger)

// jump to chat
window.history.replaceState(null, null, '/shells/chat/#' + currentChatId)
window.location = '/shells/chat/#' + currentChatId
window.location.reload()
