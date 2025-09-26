import { currentChatId } from './endpoints.mjs'
import { setupCss } from './ui/css.mjs'
import { initializeMessageInput } from './ui/messageInput.mjs'
import { setupSidebar, updateSidebar } from './ui/sidebar.mjs'
import { initializeVirtualQueue } from './ui/virtualQueue.mjs'
import { initializeWebSocket } from './websocket.mjs'

// These are shared state used by the sidebar.
// They will be updated by events from the websocket.
export let charList = []
export let worldName = null
export let personaName = null

export function setCharList(list) {
	charList = list
}
export function setWorldName(name) {
	worldName = name
}
export function setPersonaName(name) {
	personaName = name
}

export async function initializeChat() {
	setupCss()
	initializeWebSocket()

	const response = await fetch(`/api/shells/chat/${currentChatId}/initial-data`)
	const initialData = await response.json()
	initializeVirtualQueue(initialData)
	updateSidebar({
		charlist: initialData.charlist,
		worldname: initialData.worldname,
		personaname: initialData.personaname,
		frequency_data: initialData.frequency_data,
	})

	if (window.Notification && Notification?.permission != 'granted')
		Notification.requestPermission()

	setupSidebar()
	// This was in index.mjs, but it makes more sense here as it's part of the chat UI
	initializeMessageInput()
}
