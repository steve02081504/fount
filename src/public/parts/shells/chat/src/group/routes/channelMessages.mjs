/**
 * 【文件】group/routes/channelMessages.mjs
 * 【职责】频道 HTTP 路由（消息读写与线程）。
 * 【关联】被 channels.mjs 聚合注册。
 */
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { isHex64, normalizeHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { PERMISSIONS } from '../../../../../../../scripts/p2p/permissions.mjs'
import { channelMessageContentObject } from '../../../public/shared/channelContent.mjs'
import {
	applyChannelMessageDeleteHooks,
	applyChannelMessageEditHooks,
} from '../../chat/channel/channelUserHooks.mjs'
import {
	appendChannelMessageDelete,
	appendChannelMessageEdit,
	appendChannelMessageFeedback,
	CHANNEL_MESSAGE_EVENT_ID_RE,
	findChannelMessageRow,
} from '../../chat/channel/messageMutations.mjs'
import { postChannelMessage } from '../../chat/channel/postMessage.mjs'
import { decryptEventContent } from '../../chat/channel_keys/content.mjs'
import { appendSignedLocalEvent } from '../../chat/dag/append.mjs'
import { requestChannelHistoryFromPeers } from '../../chat/federation/channelHistory.mjs'
import { getChannelReadMarker, setChannelReadMarker } from '../../chat/lib/readMarkers.mjs'
import { readViewerChannelMessages } from '../../chat/session/materializeViewerLog.mjs'
import { getBufferedStreamChunks } from '../../chat/ws/groupWsStreamBuffer.mjs'
import { broadcastEvent } from '../../chat/ws/groupWsBroadcast.mjs'
import { groupWsRoomKeyForReplica } from '../../chat/ws/groupWsRooms.mjs'
import { recordEmojiUsageFromMessageContent } from '../../emojiUsage.mjs'
import { readChannelReactionsForMessages, readChannelMessagesForUser, readPinNeighborhoodForUser } from '../queries.mjs'
import { searchGroupMessages } from '../../chat/search/index.mjs'
import { resolveOperatorEntityHash } from '../../chat/lib/replica.mjs'

import {
	ensureCanInChannel,
	ensureChannel,
	resolveGroupMember,
} from './middleware.mjs'
import { GROUPS_PREFIX, EVENT_ID_PARAM } from './path.mjs'


/**
 * 注册频道 消息读写与线程 HTTP 路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerChannelMessageRoutes(router, authenticate) {
	router.post(`${GROUPS_PREFIX}/:groupId/channels/:channelId/threads`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const { channelId: parentChannelId } = req.params
		const { parentEventId } = req.body || {}
		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state } = membership
		ensureChannel(state, parentChannelId)


		const newChannelId = `thread_${Date.now()}_${randomUUID().slice(0, 8)}`
		await appendSignedLocalEvent(username, groupId, {
			type: 'channel_create',
			timestamp: Date.now(),
			content: {
				channelId: newChannelId,
				type: 'text',
				name: parentEventId ? `thread:${String(parentEventId).slice(0, 12)}` : 'Thread',
				description: '',
				parentChannelId,
				parentEventId: parentEventId ? String(parentEventId).trim().toLowerCase() : null,
				syncScope: 'channel',
			},
		})
		res.status(201).json({ channelId: newChannelId })
	})

	router.put(`${GROUPS_PREFIX}/:groupId/channels/:channelId/messages/${EVENT_ID_PARAM}`, authenticate, async (req, res) => {
		const { groupId, channelId } = req.params
		const eventId = String(req.params.eventId || '').toLowerCase()
		if (!CHANNEL_MESSAGE_EVENT_ID_RE.test(eventId))
			throw httpError(400, 'invalid eventId')
		const rawContent = req.body?.content
		if (!rawContent || typeof rawContent !== 'object' || Array.isArray(rawContent))
			throw httpError(400, 'content object required')

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state } = membership
		ensureChannel(state, channelId)

		const contentObj = channelMessageContentObject(rawContent)
		const row = await findChannelMessageRow(username, groupId, channelId, eventId)
		if (!row) throw httpError(404, 'message not found')
		const finalContent = await applyChannelMessageEditHooks(
			username, groupId, channelId, eventId, row, contentObj,
		)
		const event = await appendChannelMessageEdit(username, groupId, channelId, eventId, finalContent)
		res.status(200).json({ event })
	})

	router.delete(`${GROUPS_PREFIX}/:groupId/channels/:channelId/messages/${EVENT_ID_PARAM}`, authenticate, async (req, res) => {
		const { groupId, channelId } = req.params
		const eventId = String(req.params.eventId || '').toLowerCase()
		if (!CHANNEL_MESSAGE_EVENT_ID_RE.test(eventId))
			throw httpError(400, 'invalid eventId')

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state } = membership
		ensureChannel(state, channelId)

		const row = await findChannelMessageRow(username, groupId, channelId, eventId)
		if (!row) throw httpError(404, 'message not found')
		await applyChannelMessageDeleteHooks(username, groupId, channelId, eventId, row)
		const event = await appendChannelMessageDelete(username, groupId, channelId, eventId)
		res.status(200).json({ event })
	})

	router.put(`${GROUPS_PREFIX}/:groupId/channels/:channelId/messages/${EVENT_ID_PARAM}/feedback`, authenticate, async (req, res) => {
		const { groupId, channelId } = req.params
		const eventId = String(req.params.eventId || '').toLowerCase()
		const { type, content } = req.body || {}
		if (!CHANNEL_MESSAGE_EVENT_ID_RE.test(eventId))
			throw httpError(400, 'invalid eventId')
		if (!['up', 'down'].includes(type))
			throw httpError(400, 'type must be up or down')

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state } = membership
		ensureChannel(state, channelId)

		const event = await appendChannelMessageFeedback(username, groupId, channelId, eventId, type, content)
		res.status(200).json({ event })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/channels/:channelId/history-want`, authenticate, async (req, res) => {
		const { groupId, channelId } = req.params
		const { before: rawBefore, limit: rawLimit } = req.body || {}
		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state, member } = membership
		ensureChannel(state, channelId)
		ensureCanInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId, 'No permission to view channel')
		const before = String(rawBefore || '').trim() || undefined
		const limit = Math.min(500, Math.max(1, Number(rawLimit) || 50))
		await requestChannelHistoryFromPeers(username, groupId, channelId, { before, limit })
		const messages = await readChannelMessagesForUser(username, groupId, channelId, {
			before: before || undefined,
			limit,
		})
		res.status(200).json({ messages })
	})

	router.get(`${GROUPS_PREFIX}/:groupId/channels/:channelId/stream-buffer/:pendingStreamId`, authenticate, async (req, res) => {
		const { groupId, channelId, pendingStreamId } = req.params

		const membership = await resolveGroupMember(req, res, groupId)
		const { state, member } = membership
		ensureChannel(state, channelId)
		ensureCanInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId, 'No permission to view channel')

		res.status(200).json({ chunks: getBufferedStreamChunks(groupId, pendingStreamId) })
	})

	router.get(`${GROUPS_PREFIX}/:groupId/channels/:channelId/messages`, authenticate, async (req, res) => {
		const { groupId, channelId } = req.params
		const { since, before, limit } = req.query

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state, member } = membership
		ensureChannel(state, channelId)

		ensureCanInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId, 'No permission to view channel')

		const messages = await readChannelMessagesForUser(username, groupId, channelId, {
			since: since || undefined,
			before: before || undefined,
			limit,
		})
		const reactions = await readChannelReactionsForMessages(
			username, groupId, channelId, messages.map(m => m.eventId).filter(Boolean),
		)
		res.status(200).json({ messages, reactions })
	})

	router.get(`${GROUPS_PREFIX}/:groupId/channels/:channelId/view-log`, authenticate, async (req, res) => {
		const { groupId, channelId } = req.params
		const { since, before, limit } = req.query

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state, member } = membership
		ensureChannel(state, channelId)
		ensureCanInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId, 'No permission to view channel')

		const { messages, visibleEventIds } = await readViewerChannelMessages(username, groupId, channelId, {
			since: since || undefined,
			before: before || undefined,
			limit,
		}, { kind: 'user' })
		const reactions = await readChannelReactionsForMessages(username, groupId, channelId, visibleEventIds)
		const readMarker = getChannelReadMarker(username, groupId, channelId)
		res.status(200).json({ messages, reactions, readMarker })
	})

	router.put(`${GROUPS_PREFIX}/:groupId/channels/:channelId/read-marker`, authenticate, async (req, res) => {
		const { groupId, channelId } = req.params
		const { eventId: rawEventId, seq: rawSeq } = req.body || {}
		const eventId = String(rawEventId || '').trim().toLowerCase()
		const seq = Number(rawSeq)
		if (!CHANNEL_MESSAGE_EVENT_ID_RE.test(eventId))
			throw httpError(400, 'invalid eventId')
		if (!Number.isFinite(seq) || seq < 0)
			throw httpError(400, 'invalid seq')

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state, member } = membership
		ensureChannel(state, channelId)
		ensureCanInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId, 'No permission to view channel')

		setChannelReadMarker(username, groupId, channelId, { eventId, seq })
		const readMarker = getChannelReadMarker(username, groupId, channelId)
		broadcastEvent(groupWsRoomKeyForReplica(groupId), {
			type: 'read_marker',
			username,
			groupId,
			channelId,
			readMarker,
		})
		res.status(200).json({ readMarker })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/channels/:channelId/messages/batch-get`, authenticate, async (req, res) => {
		const { groupId, channelId } = req.params
		const rawIds = req.body?.eventIds

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state, member } = membership
		ensureChannel(state, channelId)
		ensureCanInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId, 'No permission to view channel')

		if (!Array.isArray(rawIds) || !rawIds.length)
			throw httpError(400, 'eventIds array required')
		if (rawIds.length > 500)
			throw httpError(400, 'eventIds limit 500')

		/** @type {string[]} */
		const eventIds = []
		for (const raw of rawIds) {
			const id = normalizeHex64(raw)
			if (!isHex64(id)) throw httpError(400, 'invalid eventId')
			eventIds.push(id)
		}

		const messages = await readChannelMessagesForUser(username, groupId, channelId, { eventIds })
		const reactions = await readChannelReactionsForMessages(username, groupId, channelId, eventIds)
		res.status(200).json({ messages, reactions })
	})

	router.get(`${GROUPS_PREFIX}/:groupId/channels/:channelId/pin-context/${EVENT_ID_PARAM}`, authenticate, async (req, res) => {
		const { groupId, channelId } = req.params
		const pinEventId = String(req.params.eventId || '').toLowerCase()
		if (!CHANNEL_MESSAGE_EVENT_ID_RE.test(pinEventId))
			throw httpError(400, 'invalid eventId')

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state, member } = membership
		ensureChannel(state, channelId)
		ensureCanInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId, 'No permission to view channel')

		const messages = await readPinNeighborhoodForUser(username, groupId, channelId, pinEventId)
		res.status(200).json({ messages })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/channels/:channelId/messages`, authenticate, async (req, res) => {
		const { groupId, channelId } = req.params
		const { content: rawContent, reply, files: rawFiles } = req.body || {}

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state } = membership
		ensureChannel(state, channelId)

		const processedFiles = (Array.isArray(rawFiles) ? rawFiles : []).map(file => ({
			...file,
			buffer: Buffer.from(file.buffer, 'base64'),
		}))
		const { event } = await postChannelMessage(username, groupId, channelId, {
			...reply
				? { reply: { content: reply.content, isAutoTrigger: reply.isAutoTrigger } }
				: { rawContent },
			files: processedFiles.length ? processedFiles : undefined,
			maxDagPayloadBytes: Number(state.groupSettings?.maxDagPayloadBytes) || 262_144,
		})
		const result = await decryptEventContent(username, groupId, channelId, event.content)
		/** @type {object} */
		const responseEvent = { ...event }
		if (result.ok) 
			responseEvent.content = result.content
		
		else {
			responseEvent.content = null
			responseEvent.decryptView = {
				failed: true,
				...result.generation != null ? { pendingGeneration: result.generation } : {},
			}
		}
		const content = responseEvent.content || {}
		recordEmojiUsageFromMessageContent(username, content)
		res.status(201).json({ event: responseEvent })
	})

	router.get(`${GROUPS_PREFIX}/:groupId/search`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const membership = await resolveGroupMember(req, res, groupId)
		const { username } = membership
		const query = String(req.query.q || '').trim()
		if (query.length < 2)
			throw httpError(400, 'query must be at least 2 characters')
		const viewerEntityHash = (await resolveOperatorEntityHash(username))?.toLowerCase() || null
		res.status(200).json(await searchGroupMessages(username, groupId, {
			q: query,
			channelId: req.query.channelId ? String(req.query.channelId) : undefined,
			limit: Number(req.query.limit) || 30,
			viewerEntityHash,
		}))
	})

}
