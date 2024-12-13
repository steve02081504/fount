import { getCharList, getChatLogLength } from '../public/endpoints.mjs'
import { initializeVirtualQueue } from './ui/virtualQueue.mjs'

export let charList = []

export async function initializeChat() {
	charList = await getCharList()
	const chatLogLength = await getChatLogLength()
	await initializeVirtualQueue(chatLogLength)
}
