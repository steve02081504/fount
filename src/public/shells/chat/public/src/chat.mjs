import { getInitialData } from './endpoints.mjs'
import { setupCss } from './ui/css.mjs'
import { initializeMessageInput } from './ui/messageInput.mjs'
import { setupSidebar, updateSidebar } from './ui/sidebar.mjs'
import { initializeVirtualQueue } from './ui/virtualQueue.mjs'
import { initializeWebSocket } from './websocket.mjs'

// These are shared state used by the sidebar.
// They will be updated by events from the websocket.
/**
 * 聊天角色列表。
 * @type {Array<string>}
 */
export let charList = []
/**
 * @type {Array<string>}
 */
export let pluginList = []
/**
 * 当前世界名称。
 * @type {string|null}
 */
export let worldName = null
/**
 * 当前角色名称。
 * @type {string|null}
 */
export let personaName = null

/**
 * 设置聊天角色列表。
 * @param {Array<string>} list - 角色列表。
 */
export function setCharList(list) {
	charList = list
}

/**
 * 设置插件列表。
 * @param {Array<string>} list - 插件列表。
 */
export function setPluginList(list) {
	pluginList = list
}
/**
 * 设置当前世界名称。
 * @param {string} name - 世界名称。
 */
export function setWorldName(name) {
	worldName = name
}
/**
 * 设置当前角色名称。
 * @param {string} name - 角色名称。
 */
export function setPersonaName(name) {
	personaName = name
}

/**
 * 初始化聊天。
 * @returns {Promise<void>}
 */
export async function initializeChat() {
	setupCss()
	initializeWebSocket()

	const initialData = await getInitialData()
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
