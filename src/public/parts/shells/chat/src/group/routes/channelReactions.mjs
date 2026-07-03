/**
 * 【文件】group/routes/channelReactions.mjs
 * 【职责】频道 HTTP 路由（反应/置顶/列表项）。
 * 【关联】被 channels.mjs 聚合注册。
 */
import { httpError } from '../../../../../../../scripts/http_error.mjs'
import {
	appendListItemUpdate,
	appendPinEvent,
	appendReactionEvent,
	appendUnpinEvent,
} from '../../chat/dag/channelOps.mjs'
import { triggerCharReply } from '../../chat/session/generation.mjs'

import {
	ensurePinPermission,
	requireGroupChannel,
} from './middleware.mjs'
import { GROUPS_PREFIX, EVENT_ID_PARAM } from './path.mjs'


/**
 * 注册频道 反应/置顶/列表项 HTTP 路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerChannelReactionRoutes(router, authenticate) {
	router.post(`${GROUPS_PREFIX}/:groupId/channels/:channelId/trigger-reply`, authenticate, requireGroupChannel(), async (req, res) => {
		const { groupId, channelId } = req.groupContext

		const { charname } = req.body || {}
		const resolvedCharname = String(charname || '').trim() || null

		await triggerCharReply(groupId, channelId, resolvedCharname)
		res.status(200).json({})
	})

	router.post(`${GROUPS_PREFIX}/:groupId/channels/:channelId/reactions`, authenticate, requireGroupChannel(), async (req, res) => {
		const { username, groupId, channelId } = req.groupContext
		const { targetEventId, emoji } = req.body || {}
		if (!targetEventId || !emoji)
			throw httpError(400, 'targetEventId and emoji required')

		await appendReactionEvent(username, groupId, {
			type: 'reaction_add',
			channelId,
			targetEventId,
			emoji,
		})
		res.status(200).json({})
	})

	router.delete(`${GROUPS_PREFIX}/:groupId/channels/:channelId/reactions`, authenticate, requireGroupChannel(), async (req, res) => {
		const { username, groupId, channelId, memberKey } = req.groupContext
		const { targetEventId, emoji, targetPubKeyHash } = req.body || {}
		if (!targetEventId || !emoji)
			throw httpError(400, 'targetEventId and emoji required')

		const myPubKeyHash = memberKey.toLowerCase()
		await appendReactionEvent(username, groupId, {
			type: 'reaction_remove',
			channelId,
			targetEventId,
			emoji,
			targetPubKeyHash: String(targetPubKeyHash || '').trim() || undefined,
		})
		res.status(200).json({})
	})

	router.post(`${GROUPS_PREFIX}/:groupId/channels/:channelId/pins`, authenticate, requireGroupChannel(), async (req, res) => {
		const { username, groupId, channelId, state, member } = req.groupContext
		const { targetEventId } = req.body || {}
		if (!targetEventId)
			throw httpError(400, 'targetEventId required')
		ensurePinPermission(state, member, channelId)

		await appendPinEvent(username, groupId, channelId, targetEventId)
		res.status(200).json({})
	})

	router.delete(`${GROUPS_PREFIX}/:groupId/channels/:channelId/pins/${EVENT_ID_PARAM}`, authenticate, requireGroupChannel(), async (req, res) => {
		const { username, groupId, channelId, state, member } = req.groupContext
		const targetEventId = String(req.params.eventId || '').toLowerCase()
		ensurePinPermission(state, member, channelId)

		await appendUnpinEvent(username, groupId, channelId, targetEventId)
		res.status(200).json({})
	})

	router.post(`${GROUPS_PREFIX}/:groupId/channels/:channelId/list-items`, authenticate, requireGroupChannel(), async (req, res) => {
		const { username, groupId, channelId, state } = req.groupContext
		const { items } = req.body || {}
		if (!Array.isArray(items))
			throw httpError(400, 'items array required')
		if (items.length > 128)
			throw httpError(400, 'Too many list items')

		const channel = state.channels[channelId]
		if (channel.type !== 'list')
			throw httpError(400, 'Channel is not a list channel')


		const normalized = items.map(item => {
			const row = item || {}
			return {
				title: String(row.title || '').slice(0, 200),
				description: row.description ? String(row.description).slice(0, 2000) : undefined,
				targetChannelId: row.targetChannelId ? String(row.targetChannelId).slice(0, 128) : undefined,
				url: row.url ? String(row.url).slice(0, 2048) : undefined,
			}
		})
		await appendListItemUpdate(username, groupId, channelId, normalized)
		res.status(200).json({})
	})

}
