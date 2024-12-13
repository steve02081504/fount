import { appendMessage } from './ui/messageList.mjs'
import { getCharList, getChatLog } from '../public/endpoints.mjs'

export let charList = []

export async function initializeChat() {
	charList = await getCharList()
	for (const message of await getChatLog()) await appendMessage(message)
}
