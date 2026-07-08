/**
 * 【文件】channel/channelUserHooks.mjs
 * 【职责】频道 human edit/delete 前置钩子：persona BeforeUserEdit/Delete + world MessageEdit/Delete。
 * 【原理】与 postMessage BeforeUserSend 对称；persona 先于 world；reject → httpError(400)。
 */
import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { channelMessageContentObject } from '../../../public/shared/channelContent.mjs'
import { resolveOperatorEntityHash } from '../lib/replica.mjs'
import { getMaterializedSession } from '../session/dagSession.mjs'
import { resolveWorld } from '../session/resolvePart.mjs'
import { loadPlayerForReplica } from '../session/timeSliceParts.mjs'

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<{ player: object, personaname?: string, memberId: string }>} 发送者 persona 上下文
 */
async function resolvePersonaContext(username, groupId) {
	const session = await getMaterializedSession(username, groupId)
	const { player, player_id: personaname } = await loadPlayerForReplica(username, session.personas)
	const memberId = await resolveOperatorEntityHash(username) || ''
	return { player, personaname, memberId }
}

/**
 * @param {unknown} result world/persona 钩子返回值
 * @param {object} fallback 默认 edited
 * @returns {object} 规范化 content
 */
function normalizeEditedResult(result, fallback) {
	if (result?.reject) throw httpError(400, String(result.reject))
	if (result?.edited != null) return channelMessageContentObject(result.edited)
	if (result?.type || result?.content) return channelMessageContentObject(result)
	return fallback
}

/**
 * 频道消息编辑：persona → world → 返回最终 content。
 * @param {string} username 操作者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 目标 eventId
 * @param {object} row 消息行
 * @param {object} edited 拟写入 content
 * @returns {Promise<object>} 最终 content
 */
export async function applyChannelMessageEditHooks(username, groupId, channelId, eventId, row, edited) {
	let content = channelMessageContentObject(edited)
	const { player, personaname, memberId } = await resolvePersonaContext(username, groupId)
	const baseCtx = {
		groupId,
		channelId,
		username,
		personaname,
		memberId,
		eventId,
		original: row,
	}

	const beforeEdit = player.interfaces.chat.BeforeUserEdit
	if (beforeEdit) {
		const personaResult = await beforeEdit({ ...baseCtx, edited: content })
		content = normalizeEditedResult(personaResult, content)
	}

	const world = await resolveWorld(groupId, channelId, username)
	const worldEdit = world.interfaces.chat.MessageEdit
	if (worldEdit) {
		const worldResult = await worldEdit({ ...baseCtx, edited: content })
		content = normalizeEditedResult(worldResult, content)
	}

	return content
}

/**
 * 频道消息删除：persona → world 前置拦截。
 * @param {string} username 操作者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 目标 eventId
 * @param {object} row 消息行
 * @returns {Promise<void>}
 */
export async function applyChannelMessageDeleteHooks(username, groupId, channelId, eventId, row) {
	const { player, personaname, memberId } = await resolvePersonaContext(username, groupId)
	const baseCtx = {
		groupId,
		channelId,
		username,
		personaname,
		memberId,
		eventId,
		original: row,
	}

	const beforeDelete = player.interfaces.chat.BeforeUserDelete
	if (beforeDelete) {
		const personaResult = await beforeDelete(baseCtx)
		if (personaResult?.reject)
			throw httpError(400, String(personaResult.reject))
	}

	const world = await resolveWorld(groupId, channelId, username)
	const worldDelete = world.interfaces.chat.MessageDelete
	if (worldDelete) {
		const worldResult = await worldDelete(baseCtx)
		if (worldResult?.reject)
			throw httpError(400, String(worldResult.reject))
	}
}
