/**
 * 【文件】logEntries.mjs — 聊天日志条目装配工具
 * 【职责】buildChatLogEntryFromCharReply / buildChatLogEntryFromUserMessage 将部件接口返回值转为 chatLogEntry_t；getChannelForCharStream 推断流式回复所属频道。
 * 【原理】角色条目合并 getPartDetails 的 name/avatar；用户条目写入 extension.groupChannelId；getChannelForCharStream 向前扫描 chatLog 找最近 user 消息的频道。
 * 【数据结构】chatLogEntry_t 字段（role/content/extension.timeSlice/files/extension/logContext*）。
 * 【关联】models、channelContent、messages、triggerReply、chatRequest.AddChatLogEntry。
 */
/** @typedef {import('../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../../decl/basedefs.ts').locale_t} locale_t */

import { getPartDetails } from '../../../../../../../server/parts_loader.mjs'
import { ensureLocalAgentEntityHash } from '../../entity/member.mjs'
import { resolveChannelId } from '../lib/channelId.mjs'
import { getOperatorEntityHash } from '../lib/replica.mjs'

import { chatLogEntry_t } from './models.mjs'

/**
 * 根据占位条目前的用户消息推断流式生成应归属的群频道 ID。
 * @param {chatMetadata_t} chatMetadata 元数据
 * @param {chatLogEntry_t} placeholderEntry 生成中的占位条目
 * @returns {string} 频道 ID 或 default
 */
export function getChannelForCharStream(chatMetadata, placeholderEntry) {
	const placeholderIndex = chatMetadata.chatLog.findIndex(entry => entry.id === placeholderEntry.id)
	for (let index = placeholderIndex - 1; index >= 0; index--) {
		const logEntry = chatMetadata.chatLog[index]
		const groupChannelId = logEntry.extension?.groupChannelId
		if (logEntry.role === 'user') {
			const fromLog = resolveChannelId(groupChannelId, '')
			if (fromLog) return fromLog
		}
	}
	return 'default'
}

/**
 * 将角色 GetReply/GetGreeting 结果装配为 chatLogEntry_t。
 * @param {object} result 角色接口返回对象
 * @param {timeSlice_t} timeSlice 快照时间切片
 * @param {CharAPI_t | null} char 角色部件（世界问候时可为 null）
 * @param {string | undefined} charname 角色名
 * @param {string} username 用户
 * @returns {Promise<chatLogEntry_t>} 新日志条目
 */
export async function buildChatLogEntryFromCharReply(result, timeSlice, char, charname, username) {
	timeSlice.charname = charname
	const { info } = await getPartDetails(username, `chars/${charname}`) || {}
	const { timeSlice: _drop, ...extensionRest } = result.extension || {}

	const entry = new chatLogEntry_t()

	Object.assign(entry, {
		name: result.name || info?.name || charname || 'Unknown',
		...charname
			? { uid: await ensureLocalAgentEntityHash(username, charname) }
			: {},
		avatar: result.avatar || info?.avatar,
		content: result.content,
		content_for_show: result.content_for_show,
		content_for_edit: result.content_for_edit,
		role: 'char',
		time_stamp: new Date(),
		files: result.files || [],
		logContextBefore: result.logContextBefore,
		logContextAfter: result.logContextAfter,
		charVisibility: result.charVisibility,
		visibility: result.visibility,
	})
	entry.extension = { ...extensionRest, timeSlice }
	return entry
}

/**
 * 将用户发送载荷装配为 chatLogEntry_t（含群频道扩展）。
 * @param {object} result 用户消息对象
 * @param {timeSlice_t} timeSlice 快照时间切片
 * @param {UserAPI_t | undefined} user 用户部件
 * @param {string | undefined} personaname 人格名
 * @param {string} username 用户
 * @returns {Promise<chatLogEntry_t>} 新日志条目
 */
export async function buildChatLogEntryFromUserMessage(result, timeSlice, user, personaname, username) {
	timeSlice.playername = timeSlice.player_id
	const { info } = (personaname ? await getPartDetails(username, `personas/${personaname}`) : undefined) || {}
	const { timeSlice: _drop, ...extension } = result.extension || {}
	const groupChannelId = resolveChannelId(result.groupChannelId, '')
	if (groupChannelId) extension.groupChannelId = groupChannelId
	const entry = new chatLogEntry_t()
	Object.assign(entry, {
		name: result.name || info?.name || timeSlice.player_id || username,
		uid: result.uid || await getOperatorEntityHash(username) || undefined,
		avatar: result.avatar || info?.avatar,
		content: result.content,
		role: 'user',
		time_stamp: new Date(),
		files: result.files || [],
		charVisibility: result.charVisibility,
		visibility: result.visibility,
	})
	entry.extension = { ...extension, timeSlice }
	return entry
}
