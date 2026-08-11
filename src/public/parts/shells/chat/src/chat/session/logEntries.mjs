/**
 * 【文件】logEntries.mjs — 聊天日志条目装配工具
 * 【职责】buildChatLogEntryFromCharReply 将部件接口返回值转为 chatLogEntry_t；getChannelForCharStream 推断流式回复所属频道。
 * 【原理】角色条目合并 getPartDetails 的 name/avatar；getChannelForCharStream 向前扫描 chatLog 找最近 user 消息的频道。
 * 【数据结构】chatLogEntry_t 字段（role/content/extension.timeSlice/files/extension/logContext*）。
 * 【关联】models、channelContent、messages、triggerReply、chatRequest.AddChatLogEntry。
 */
import { getPartDetails } from '../../../../../../../server/parts_loader.mjs'
import { ensureLocalAgentEntityHash } from '../../entity/member.mjs'
import { resolveChannelId } from '../lib/channelId.mjs'

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
		const channelId = logEntry.extension?.chat?.channelId
		if (logEntry.role === 'user') {
			const fromLog = resolveChannelId(channelId, '')
			if (fromLog) return fromLog
		}
	}
	return 'default'
}

/**
 * 将角色 GetReply/GetGreeting 结果装配为 chatLogEntry_t。
 * @param {object} result 角色接口返回对象
 * @param {timeSlice_t} timeSlice 快照时间切片
 * @param {string | undefined} charname 角色名
 * @param {string} username 用户
 * @returns {Promise<chatLogEntry_t>} 新日志条目
 */
export async function buildChatLogEntryFromCharReply(result, timeSlice, charname, username) {
	timeSlice.charname = charname || undefined
	const { info } = charname && await getPartDetails(username, `chars/${charname}`) || {}
	const { timeSlice: _drop, ...extensionRest } = result.extension || {}

	const entry = new chatLogEntry_t()

	Object.assign(entry, {
		name: result.name || info?.name || charname || 'Unknown',
		uid: charname
			? await ensureLocalAgentEntityHash(username, charname)
			: 'char',
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
