import { setupCss } from './ui/css.mjs'
import { initializeMessageInput } from './ui/messageInput.mjs'
import { setupSidebar } from './ui/sidebar.mjs'
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
	initializeWebSocket() // This will connect and fetch initial data

	if (window.Notification && Notification?.permission != 'granted')
		Notification.requestPermission()

	setupSidebar()
	// This was in index.mjs, but it makes more sense here as it's part of the chat UI
	initializeMessageInput()
}
