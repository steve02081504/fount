/**
 * fount API 插件 ReplyHandler：自动申请 API key 并保存到角色配置中。
 */

import { generateApiKey } from '../../../../server/auth/index.mjs'
import { loadData, saveData } from '../../../../server/setting_loader.mjs'
import { defineReplyHandler } from '../../shells/chat/src/reply/defineReplyHandler.mjs'

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
 * fount API ReplyHandler：检查是否需要自动申请 API key（内容型 handler，无标签）。
 * @type {import('../../../../decl/pluginAPI.ts').ReplyHandler_t}
 */
export const fountApiReplyHandler = defineReplyHandler({
	/**
	 * 确保角色有 API key。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args) => {
		await ensureApiKey(args.username, args.char_id)
		return {}
	},
})
