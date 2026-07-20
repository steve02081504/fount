/**
 * 【文件】generationFeedback.mjs — 消息反馈镜像到 DAG
 * 【职责】mirrorFeedbackToDag 将 UI 设置的赞/踩等 feedback 写成签名本地事件 message_feedback，供多端同步与审计。
 * 【原理】跳过问候条目与无 dagEventId 的条目；resolveLocalEventSigner 得 sender；content 含 targetId、feedbackType、chatLogEntryId；失败仅 console.error 不抛。
 * 【数据结构】feedback { type, content? }；DAG 事件 type: message_feedback。
 * 【关联】messages.setMessageFeedback、dag/append、ensureGroup、channelId 解析。
 */
/** @typedef {import('../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../../decl/basedefs.ts').locale_t} locale_t */

import { appendSignedLocalEvent } from '../dag/append.mjs'
import { ensureGroup } from '../dag/lifecycle.mjs'
import { resolveLocalEventSigner } from '../dag/localSigner.mjs'
import { resolveGroupChannelId } from '../lib/channelId.mjs'

/**
 * 将赞踩等反馈镜像为 DAG message_feedback 事件。
 * @param {string} groupId 聊天 ID
 * @param {chatLogEntry_t} entry 目标条目
 * @param {{ type: string, content?: string }} feedback 反馈载荷
 * @param {string} username 所有者
 * @returns {Promise<void>}
 */
export async function mirrorFeedbackToDag(groupId, entry, feedback, username) {
	try {
		if (!entry?.id || !username) return
		if (entry.extension.timeSlice?.greeting_type) return
		if (!feedback?.type) return
		const targetId = entry.extension?.dagEventId
		if (!targetId) return
		await ensureGroup(username, groupId)
		const { sender } = await resolveLocalEventSigner(username, groupId)
		const channelIdForDag = await resolveGroupChannelId(username, groupId, entry.extension?.groupChannelId)
		await appendSignedLocalEvent(username, groupId, {
			type: 'message_feedback',
			channelId: channelIdForDag,
			timestamp: Date.now(),
			content: {
				targetId,
				charOwner: sender,
				feedbackType: feedback.type,
				feedbackContent: feedback.content,
				chatLogEntryId: entry.id,
			},
		})
	}
	catch (e) {
		console.error(e)
	}
}
