/**
 * 【文件】persistence.mjs — 活跃群 runtime 访问与列表摘要
 * 【职责】getActiveGroupRuntime 从 groupMetadatas 解析 owner 并委托 getGroupRuntime；isVividGroup 判断是否有非问候正文；getSummaryFromMetadata 构造历史列表行。
 * 【原理】未注册群返回 undefined；摘要取 chatLog 末条非问候消息的展示字段；vivid 聊天在 WS 卸载时保留内存槽位仅清空 chatMetadata。
 * 【数据结构】摘要对象 { groupId, chars, lastMessageSender, lastMessageContent, lastMessageTime }。
 * 【关联】runtime、wsLifecycle、crud.listGroupSessions、chatLogAppend。
 */
/** @typedef {import('../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../../decl/basedefs.ts').locale_t} locale_t */

import { resolveActiveMemberKeyForLocalUser } from '../../group/access.mjs'
import { getState } from '../dag/materialize.mjs'

import { chatMetadata_t } from './models.mjs'
import { getGroupRuntime } from './runtime.mjs'
import { groupMetadatas } from './wsLifecycle.mjs'

/**
 * 从内存元数据构造聊天列表摘要条目（非活跃聊天返回 null）。
 * @param {string} groupId 聊天 ID
 * @param {chatMetadata_t} chatMetadata 元数据实例
 * @returns {object | null} 摘要对象或 null
 */
export function getSummaryFromMetadata(groupId, chatMetadata) {
	if (!chatMetadata?.LastTimeSlice) return null
	const lastEntry = chatMetadata.chatLog?.findLast?.(Boolean)
	return {
		groupId,
		chars: Object.keys(chatMetadata.LastTimeSlice.chars || {}),
		lastMessageSender: lastEntry?.name || '',
		lastMessageSenderAvatar: lastEntry?.avatar || null,
		lastMessageContent: lastEntry?.content || '',
		lastMessageTime: lastEntry?.time_stamp || null,
	}
}

/**
 * 返回已注册群的内存 AI runtime（未注册则从 DAG 物化并缓存）。
 * @param {string} groupId 群 ID
 * @returns {Promise<chatMetadata_t | undefined>} 群 runtime 元数据，未注册时 undefined
 */
export async function getActiveGroupRuntime(groupId) {
	const chatData = groupMetadatas.get(groupId)
	if (!chatData?.username) return undefined
	return getGroupRuntime(groupId, chatData.username)
}

/**
 * @param {chatMetadata_t} chatMetadata 元数据
 * @returns {number|undefined} 非问候消息条数
 */
export function isVividGroup(chatMetadata) {
	return chatMetadata?.chatLog?.filter?.(entry => entry && !entry.timeSlice?.greeting_type)?.length
}

/**
 * 本机 replica 是否为群创建者（持有 founder 角色）。
 * @param {string} username replica 所有者
 * @param {string} groupId 群 ID
 * @returns {Promise<boolean>} 本地活跃成员持有 founder 时为 true
 */
export async function isLocallyOwnedGroup(username, groupId) {
	const { state } = await getState(username, groupId, { skipLeftPurge: true })
	const memberKey = await resolveActiveMemberKeyForLocalUser(username, groupId, state)
	return !!memberKey && !!state.members[memberKey]?.roles?.includes('founder')
}
