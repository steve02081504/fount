import { currentChatId, addCharacter, createNewChat } from "../src/public/endpoints.mjs"

await createNewChat()

let serchParams = new URLSearchParams(window.location.search)

if (serchParams.has('charname'))
	await addCharacter(serchParams.get('charname'))

// jump to chat
window.history.replaceState(null, null, '/shells/chat/#' + currentChatId)
window.location = '/shells/chat/#' + currentChatId
window.location.reload()
