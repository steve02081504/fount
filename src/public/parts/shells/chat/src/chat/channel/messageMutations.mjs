/**
 * 【文件】channel/messageMutations.mjs
 * 【职责】频道消息编辑/删除/反馈：按 eventId 查 JSONL 行并追加对应 DAG 签名事件。
 * 【原理】findChannelMessageRow 先查物化索引再扫 messages JSONL；appendChannelMessageEdit/Delete 走 appendSignedLocalEvent。
 * 【数据结构】CHANNEL_MESSAGE_EVENT_ID_RE；message_edit/delete 的 content.targetId、newContent。
 * 【关联】dag/append、materialize、paths messagesPath；Hub messageActions。
 */
import { readJsonl } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { stripDagEventLocalExtensions } from '../../../../../../../scripts/p2p/dag/strip_extensions.mjs'
import { HEX_ID_64 as EVENT_ID_HEX } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { channelMessageContentObject } from '../../../public/shared/channelContent.mjs'
import { isEventArchivedInManifest, loadArchiveManifest } from '../archive/index.mjs'
import { postSnapshotToMessageLine } from '../archive/postSnapshot.mjs'
import { readArchiveMonth } from '../archive/reader.mjs'
import { appendSignedLocalEvent } from '../dag/append.mjs'
import { resolveLocalEventSigner } from '../dag/localSigner.mjs'
import { getState } from '../dag/materialize.mjs'
import { messagesPath } from '../lib/paths.mjs'

/**
 * 频道 message 行 eventId 的 64 位 hex 校验正则。
 */
export const CHANNEL_MESSAGE_EVENT_ID_RE = EVENT_ID_HEX

/**
 * @param {object} line 频道 JSONL 行
 * @returns {string} 编辑/删除/反馈锚点 id
 */
export function channelMessageTargetId(line) {
	return String(line?.eventId || '').trim()
}

/**
 * 按 eventId 在频道 JSONL 中查找 message 行。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 事件 ID（64 hex）
 * @returns {Promise<object | null>} 消息行或 null
 */
export async function findChannelMessageRow(username, groupId, channelId, eventId) {
	const eventIdNorm = String(eventId).trim().toLowerCase()
	if (!CHANNEL_MESSAGE_EVENT_ID_RE.test(eventIdNorm)) return null

	const lines = await readJsonl(messagesPath(username, groupId, channelId), { sanitize: stripDagEventLocalExtensions })
	const hot = lines.find(row =>
		row.type === 'message' && String(row.eventId).toLowerCase() === eventIdNorm,
	)
	if (hot) return hot

	const { state } = await getState(username, groupId)
	const indexed = state.messageSenderIndex?.[eventIdNorm]
	if (indexed && String(indexed.channelId) === String(channelId))
		return {
			eventId: eventIdNorm,
			type: 'message',
			sender: indexed.sender,
			charId: indexed.charId || null,
			content: { charOwner: indexed.charOwner || null },
		}

	const manifest = await loadArchiveManifest(username, groupId)
	if (!isEventArchivedInManifest(manifest, channelId, eventIdNorm)) return null
	const month = manifest.archivedEventIds[channelId]?.[eventIdNorm]
	if (!month) return null
	const snaps = await readArchiveMonth(username, groupId, channelId, month)
	const snap = snaps.find(s => String(s.eventId).trim().toLowerCase() === eventIdNorm)
	if (!snap) return null
	return postSnapshotToMessageLine(snap)
}

/**
 * 追加 `message_edit` DAG 事件。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 目标消息 eventId
 * @param {object} newContent 新正文对象
 * @returns {Promise<object>} 签名后事件
 */
export async function appendChannelMessageEdit(username, groupId, channelId, eventId, newContent) {
	const contentObj = channelMessageContentObject(newContent)
	if (!contentObj?.content && !contentObj?.type) throw new Error('content required')
	const row = await findChannelMessageRow(username, groupId, channelId, eventId)
	if (!row) throw new Error('message not found')
	const targetId = channelMessageTargetId(row)
	const event = await appendSignedLocalEvent(username, groupId, {
		type: 'message_edit',
		channelId,
		timestamp: Date.now(),
		content: {
			targetId,
			newContent: contentObj,
			chatLogEntryId: row.content?.chatLogEntryId,
		},
	})
	const { refreshArchivedSnapshotIfPresent } = await import('../archive/refreshSnapshot.mjs')
	void refreshArchivedSnapshotIfPresent(username, groupId, channelId, targetId).catch(console.error)
	return event
}

/**
 * 追加 `message_delete` DAG 事件。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 目标消息 eventId
 * @returns {Promise<object>} 签名后事件
 */
export async function appendChannelMessageDelete(username, groupId, channelId, eventId) {
	const row = await findChannelMessageRow(username, groupId, channelId, eventId)
	if (!row) throw new Error('message not found')
	const targetId = channelMessageTargetId(row)
	const event = await appendSignedLocalEvent(username, groupId, {
		type: 'message_delete',
		channelId,
		timestamp: Date.now(),
		content: {
			targetId,
			chatLogEntryId: row.content?.chatLogEntryId,
		},
	})
	const { refreshArchivedSnapshotIfPresent } = await import('../archive/refreshSnapshot.mjs')
	void refreshArchivedSnapshotIfPresent(username, groupId, channelId, targetId, { markDeleted: true })
		.catch(console.error)
	return event
}

/**
 * 追加 `message_feedback` DAG 事件。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 目标消息 eventId
 * @param {'up'|'down'} type 赞或踩
 * @param {string} [reason] 可选原因
 * @returns {Promise<object>} 签名后事件
 */
export async function appendChannelMessageFeedback(username, groupId, channelId, eventId, type, reason) {
	if (!['up', 'down'].includes(type)) throw new Error('type must be up or down')
	const row = await findChannelMessageRow(username, groupId, channelId, eventId)
	if (!row) throw new Error('message not found')
	if (!row.charId) throw new Error('feedback only for char messages')
	const targetId = channelMessageTargetId(row)
	const { sender } = await resolveLocalEventSigner(username, groupId)
	return appendSignedLocalEvent(username, groupId, {
		type: 'message_feedback',
		channelId,
		timestamp: Date.now(),
		content: {
			targetId,
			charOwner: sender,
			feedbackType: type,
			feedbackContent: String(reason || '').slice(0, 4000),
			chatLogEntryId: row.content?.chatLogEntryId,
		},
	})
}
