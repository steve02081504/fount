import { showToastI18n } from '../../../../../scripts/toast.mjs'


import { initializeAchievements } from './achievements.mjs'
import { addCharacter, setPersona, setWorld, addPlugin, getInitialData } from './endpoints.mjs'
import { setupCss } from './ui/css.mjs'
import { initializeMessageInput } from './ui/messageInput.mjs'
import { setupSidebar, updateSidebar } from './ui/sidebar.mjs'
import { initializeVirtualQueue } from './ui/virtualQueue.mjs'
import { sendWebsocketMessage, initializeWebSocket } from './websocket.mjs'

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
	initializeAchievements()

	const initialData = await getInitialData()
	initializeVirtualQueue(initialData)
	updateSidebar({
		charlist: initialData.charlist,
		pluginlist: initialData.pluginlist,
		worldname: initialData.worldname,
		personaname: initialData.personaname,
		frequency_data: initialData.frequency_data,
	})

	if (window.Notification && Notification?.permission != 'granted')
		Notification.requestPermission()

	setupSidebar()
	// This was in index.mjs, but it makes more sense here as it's part of the chat UI
	initializeMessageInput()

	// Add global drag-and-drop support for x-fount-part
	document.body.addEventListener('dragover', event => {
		event.preventDefault() // Allow drop
	})

	document.body.addEventListener('drop', async event => {
		event.preventDefault()
		const partData = event?.dataTransfer?.getData?.('x-fount-part')
		if (!partData) return
		const [partType, partName] = partData.split('/')
		if (!partType || !partName) return showToastI18n('error', 'chat.dragAndDrop.invalidPartData')

		try {
			switch (partType) {
				case 'chars':
					await addCharacter(partName)
					showToastI18n('success', 'chat.dragAndDrop.charAdded', { partName })
					break
				case 'personas':
					await setPersona(partName)
					showToastI18n('success', 'chat.dragAndDrop.personaSet', { partName })
					break
				case 'worlds':
					await setWorld(partName)
					showToastI18n('success', 'chat.dragAndDrop.worldSet', { partName })
					break
				case 'plugins':
					await addPlugin(partName)
					showToastI18n('success', 'chat.dragAndDrop.pluginAdded', { partName })
					break
				default:
					showToastI18n('warning', 'chat.dragAndDrop.unsupportedPartType', { partType })
					return
			}
		} catch (error) {
			console.error(`Error handling dropped part (${partType}/${partName}):`, error)
			showToastI18n('error', 'chat.dragAndDrop.errorAddingPart', { partName, error: error.message })
		}
	})
}

/**
 * 停止生成。
 * @param {string} id - 消息 ID。
 */
export function stopGeneration(id) {
	console.log('Stop generation for', id)
	sendWebsocketMessage({
		type: 'stop_generation',
		payload: { messageId: id },
	})
	// UI change is now optimistic, backend will confirm by replacing the message or just stopping the stream.
	const element = document.getElementById(id)
	if (element) {
		const stopButton = element.querySelector('.stop-generating-button')
		if (stopButton) stopButton.remove()
	}
}
