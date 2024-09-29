import { createNewChat, addCharacter } from "../src/public/endpoints.mjs"

let serchParams = new URLSearchParams(window.location.search)
let chatid = await createNewChat()

if (serchParams.has('charname'))
	await addCharacter(serchParams.get('charname'))

// jump to chat
window.location.href = '/shells/chat/#' + chatid
window.location.reload()
