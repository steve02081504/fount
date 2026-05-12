/**
 * 旧版「主 index + 单聊 WS」已废弃；主 UI 在 hub。保留若干导出供遗留模块静态 import 不炸。
 */

import { sendWebsocketMessage } from './websocket.mjs'

/** @type {string[]} */
export let charList = []
/** @type {string[]} */
export let pluginList = []
/** @type {string|null} */
export let worldName = null
/** @type {string|null} */
export let personaName = null
/** @type {object|null} */
export let groupSettings = null

/**
 * @param {string[]} list 角色名列表
 * @returns {void}
 */
export function setCharList(list) {
	charList = list
}

/**
 * @param {string[]} list 插件名列表
 * @returns {void}
 */
export function setPluginList(list) {
	pluginList = list
}

/**
 * @param {string} name 世界名
 * @returns {void}
 */
export function setWorldName(name) {
	worldName = name
}

/**
 * @param {string} name 人设名
 * @returns {void}
 */
export function setPersonaName(name) {
	personaName = name
}

/**
 * @param {object|null} s 群设置草稿
 * @returns {void}
 */
export function setGroupSettingsState(s) {
	groupSettings = s
}

/**
 * 请求停止流式生成（经当前群 WS，若已连接）。
 * @param {string} id 消息 ID
 * @returns {void}
 */
export function stopGeneration(id) {
	sendWebsocketMessage({
		type: 'stop_generation',
		payload: { messageId: id },
	})
}
