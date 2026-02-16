/**
 * fount API 插件 ReplyHandler：自动申请 API key 并保存到角色配置中。
 */

import { generateApiKey } from '../../../../server/auth.mjs'
import { loadData, saveData } from '../../../../server/setting_loader.mjs'

const PLUGIN_PARTPATH = 'plugins/fount-api'

/**
 * 从 parts_config 中按角色获取 fount API 密钥。
 * @param {string} username - 用户名。
 * @param {string} charId - 角色 ID。
 * @returns {string | undefined} 该角色的密钥，未配置则为 undefined。
 */
function getKeyForChar(username, charId) {
	const parts_config = loadData(username, 'parts_config')
	const apikeys = parts_config[PLUGIN_PARTPATH]?.apikeys ?? {}
	return apikeys[charId]
}

/**
 * 保存角色对应的密钥到 parts_config。
 * @param {string} username - 用户名。
 * @param {string} charId - 角色 ID。
 * @param {string} apiKey - 要保存的 API 密钥。
 * @returns {void}
 */
function saveKeyForChar(username, charId, apiKey) {
	const parts_config = loadData(username, 'parts_config')
	parts_config[PLUGIN_PARTPATH] ??= { apikeys: {} }
	parts_config[PLUGIN_PARTPATH].apikeys[charId] = apiKey
	saveData(username, 'parts_config')
}

/**
 * 确保角色有 API key，如果没有则自动申请。
 * @param {string} username - 用户名。
 * @param {string} charId - 角色 ID。
 * @returns {Promise<string>} API key。
 */
async function ensureApiKey(username, charId) {
	let apiKey = getKeyForChar(username, charId)
	if (!apiKey) {
		const { apiKey: newApiKey } = await generateApiKey(username, `fount-api plugin for char: ${charId}`)
		apiKey = newApiKey
		saveKeyForChar(username, charId, apiKey)
	}
	return apiKey
}

/**
 * fount API ReplyHandler：检查是否需要自动申请 API key。
 * @type {import('../../../../decl/PluginAPI.ts').ReplyHandler_t}
 * @returns {Promise<boolean>} 若处理了则返回 false（不需要重新生成）。
 */
export async function fountApiReplyHandler(reply, args) {
	// 确保角色有 API key
	await ensureApiKey(args.username, args.char_id)
	// 不需要重新生成回复
	return false
}
