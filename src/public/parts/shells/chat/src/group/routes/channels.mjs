/**
 * 【文件】group/routes/channels.mjs
 * 【职责】频道级 HTTP：消息收发、反应/置顶、投票、流媒体、线程、元数据/设置与频道 CRUD。
 * 【原理】resolveGroupMember 统一成员校验；写操作 appendSignedLocalEvent 或 channelOps/postMessage；读消息走 queries.readChannelMessagesForUser；权限经 canInChannel 闸门。
 * 【数据结构】物化 channels、消息 event、reaction/pin/list-item 载荷、base64 上传 files。
 * 【关联】被 group/endpoints.mjs 注册；依赖 chat/channel/*、chat/dag、queries.mjs、access.mjs、emojiUsage。
 */
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { isHex64, normalizeHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { prefixedRandomId } from '../../../../../../../scripts/p2p/id.mjs'
import { PERMISSIONS } from '../../../../../../../scripts/p2p/permissions.mjs'
import { CHANNEL_MESSAGE_EVENT_ID_RE } from '../../chat/channel/messageMutations.mjs'
import { appendSignedLocalEvent } from '../../chat/dag/append.mjs'
import {
	appendListItemUpdate,
	appendPinEvent,
	appendReactionEvent,
	appendStreamingSession,
	appendUnpinEvent,
} from '../../chat/dag/channelOps.mjs'
import { requestChannelHistoryFromPeers } from '../../chat/federation/channelHistory.mjs'
import { getCurrentFileMasterKey } from '../../chat/file_keys/store.mjs'
import { channelMessageText } from '../../chat/lib/channelContent.mjs'
import { EVENT_ID_ROUTE_SEGMENT } from '../../chat/lib/hexRoute.mjs'
import { triggerCharReply } from '../../chat/session/generation.mjs'
import { buildStreamingEmbedUrl, mintStreamingViewToken } from '../../chat/stream/auth.mjs'
import { readChannelReactionEvents, readChannelMessagesForUser, readPinNeighborhoodForUser } from '../queries.mjs'
import { ChannelMessageService } from '../services/ChannelMessageService.mjs'

import {
	ensureCanInChannel,
	ensureCanInChannelSend,
	ensureChannel,
	ensurePinPermission,
	requireGroupChannel,
	requireGroupMember,
	resolveGroupMember,
} from './middleware.mjs'

/**
 * 注册频道相关 HTTP 路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerChannelRoutes(router, authenticate) {
	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/trigger-reply$/, authenticate, requireGroupChannel(), async (req, res) => {
		const { groupId, channelId } = req.groupContext

		const { charname } = req.body || {}
		const resolvedCharname = String(charname || '').trim() || null

		await triggerCharReply(groupId, channelId, resolvedCharname)
		res.status(200).json({})
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/reactions$/, authenticate, requireGroupChannel(), async (req, res) => {
		const { username, groupId, channelId } = req.groupContext
		const { targetEventId, emoji } = req.body || {}
		if (!targetEventId || !emoji)
			return res.status(400).json({ error: 'targetEventId and emoji required' })

		await appendReactionEvent(username, groupId, {
			type: 'reaction_add',
			channelId,
			targetEventId,
			emoji,
		})
		res.status(200).json({})
	})

	router.delete(new RegExp('^/api/parts/shells:chat/groups/([^/]+)/channels/([^/]+)/reactions/(.+)$'), authenticate, requireGroupChannel(), async (req, res) => {
		const { username, groupId, channelId, memberKey } = req.groupContext
		const emoji = decodeURIComponent(req.params[2])
		const targetPubKeyHash = String(req.query.targetPubKeyHash || '').trim() || undefined
		const targetEventId = String(req.query.targetEventId || '').trim()
		if (!targetEventId || !emoji)
			return res.status(400).json({ error: 'targetEventId query and emoji path required' })

		const myPubKeyHash = memberKey.toLowerCase()
		await appendReactionEvent(username, groupId, {
			type: 'reaction_remove',
			channelId,
			targetEventId,
			emoji,
			targetPubKeyHash,
		})
		res.status(200).json({})
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/pins$/, authenticate, requireGroupChannel(), async (req, res) => {
		const { username, groupId, channelId, state, member } = req.groupContext
		const { targetEventId } = req.body || {}
		if (!targetEventId)
			return res.status(400).json({ error: 'targetEventId required' })
		if (!ensurePinPermission(res, state, member, channelId)) return

		await appendPinEvent(username, groupId, channelId, targetEventId)
		res.status(200).json({})
	})

	router.delete(new RegExp(`^/api/parts/shells:chat/groups/([^/]+)/channels/([^/]+)/pins/(${EVENT_ID_ROUTE_SEGMENT})$`, 'i'), authenticate, requireGroupChannel(), async (req, res) => {
		const { username, groupId, channelId, state, member } = req.groupContext
		const targetEventId = String(req.params[2] || '').toLowerCase()
		if (!ensurePinPermission(res, state, member, channelId)) return

		await appendUnpinEvent(username, groupId, channelId, targetEventId)
		res.status(200).json({})
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/list-items$/, authenticate, requireGroupChannel(), async (req, res) => {
		const { username, groupId, channelId, state } = req.groupContext
		const { items } = req.body || {}
		if (!Array.isArray(items))
			return res.status(400).json({ error: 'items array required' })
		if (items.length > 128)
			return res.status(400).json({ error: 'Too many list items' })

		const channel = state.channels[channelId]
		if (channel.type !== 'list')
			return res.status(400).json({ error: 'Channel is not a list channel' })


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

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/streaming-view$/, authenticate, requireGroupMember(), async (req, res) => {
		const { username, state, member, groupId } = req.groupContext
		const channelId = req.params[1]
		const channel = state.channels[channelId]
		if (!channel)
			return res.status(404).send('Channel not found')
		if (channel.type !== 'streaming')
			return res.status(400).send('Channel is not a streaming channel')

		if (!ensureCanInChannelSend(res, state, member, PERMISSIONS.VIEW_CHANNEL, channelId, 'VIEW_CHANNEL denied')) return

		const baseUrl = state.groupSettings?.streamingSfuWss?.trim() || ''
		if (!baseUrl)
			return res.status(404).send('External SFU not configured')

		const keyEntry = await getCurrentFileMasterKey(username, groupId)
		if (!keyEntry?.fileMasterKey)
			return res.status(400).send('Group encryption (GSH) not initialized')

		const { sessionId, token, expiresAt } = mintStreamingViewToken(
			username, groupId, channelId, undefined, keyEntry.fileMasterKey,
		)
		await appendStreamingSession(username, groupId, channelId, { sessionId, expiresAt })
		const sfuEmbedUrlWithToken = buildStreamingEmbedUrl(baseUrl, token)
		const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{width:100%;height:100%}#streaming-embed-frame{width:100%;height:100%;border:0;display:block}</style></head><body><iframe id="streaming-embed-frame" allow="autoplay; fullscreen; picture-in-picture" referrerpolicy="no-referrer"></iframe><script>document.getElementById('streaming-embed-frame').src=${JSON.stringify(sfuEmbedUrlWithToken)};</script></body></html>`
		res.setHeader('Content-Type', 'text/html; charset=utf-8')
		res.setHeader('X-Frame-Options', 'SAMEORIGIN')
		res.setHeader('Cache-Control', 'no-store')
		res.status(200).send(html)
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/streaming-auth$/, authenticate, requireGroupMember(), async (req, res) => {
		const { username, state, member, groupId } = req.groupContext
		const channelId = req.params[1]
		const channel = state.channels[channelId]
		if (!channel)
			return res.status(404).json({ error: 'Channel not found' })
		if (channel.type !== 'streaming')
			return res.status(400).json({ error: 'Channel is not a streaming channel' })

		if (!ensureCanInChannel(res, state, member, PERMISSIONS.VIEW_CHANNEL, channelId, 'VIEW_CHANNEL denied')) return

		const baseUrl = state.groupSettings?.streamingSfuWss?.trim() || ''
		if (!baseUrl) {
			const { resolveIceServers } = await import('../../../../../../../scripts/p2p/ice_servers.mjs')
			return res.status(200).json({ mode: 'webrtc', iceServers: resolveIceServers(state.groupSettings) })
		}

		const keyEntry = await getCurrentFileMasterKey(username, groupId)
		if (!keyEntry?.fileMasterKey)
			return res.status(400).json({ error: 'Group encryption (GSH) not initialized' })

		const { sessionId, token, expiresAt } = mintStreamingViewToken(
			username, groupId, channelId, undefined, keyEntry.fileMasterKey,
		)
		await appendStreamingSession(username, groupId, channelId, { sessionId, expiresAt })
		res.status(200).json({
			mode: 'sfu',
			sessionId,
			token,
			expiresAt,
			embedUrl: buildStreamingEmbedUrl(baseUrl, token),
		})
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/threads$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const parentChannelId = req.params[1]
		const { parentEventId } = req.body || {}
		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state } = membership
		if (!ensureChannel(res, state, parentChannelId)) return


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

	router.put(new RegExp(`^/api/parts/shells:chat/groups/([^/]+)/channels/([^/]+)/messages/(${EVENT_ID_ROUTE_SEGMENT})$`, 'i'), authenticate, async (req, res) => {
		const groupId = req.params[0]
		const channelId = req.params[1]
		const eventId = String(req.params[2] || '').toLowerCase()
		if (!CHANNEL_MESSAGE_EVENT_ID_RE.test(eventId))
			return res.status(400).json({ error: 'invalid eventId' })
		const rawContent = req.body?.content
		const text = typeof rawContent === 'string' ? rawContent : channelMessageText(rawContent)
		if (!text?.trim())
			return res.status(400).json({ error: 'content required' })

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state } = membership
		if (!ensureChannel(res, state, channelId)) return

		const event = await ChannelMessageService.editMessage(username, groupId, channelId, eventId, text)
		res.status(200).json({ event })
	})

	router.delete(new RegExp(`^/api/parts/shells:chat/groups/([^/]+)/channels/([^/]+)/messages/(${EVENT_ID_ROUTE_SEGMENT})$`, 'i'), authenticate, async (req, res) => {
		const groupId = req.params[0]
		const channelId = req.params[1]
		const eventId = String(req.params[2] || '').toLowerCase()
		if (!CHANNEL_MESSAGE_EVENT_ID_RE.test(eventId))
			return res.status(400).json({ error: 'invalid eventId' })

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state } = membership
		if (!ensureChannel(res, state, channelId)) return

		const event = await ChannelMessageService.deleteMessage(username, groupId, channelId, eventId)
		res.status(200).json({ event })
	})

	router.put(new RegExp(`^/api/parts/shells:chat/groups/([^/]+)/channels/([^/]+)/messages/(${EVENT_ID_ROUTE_SEGMENT})/feedback$`, 'i'), authenticate, async (req, res) => {
		const groupId = req.params[0]
		const channelId = req.params[1]
		const eventId = String(req.params[2] || '').toLowerCase()
		const { type, content } = req.body || {}
		if (!CHANNEL_MESSAGE_EVENT_ID_RE.test(eventId))
			return res.status(400).json({ error: 'invalid eventId' })
		if (!['up', 'down'].includes(type))
			return res.status(400).json({ error: 'type must be up or down' })

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state } = membership
		if (!ensureChannel(res, state, channelId)) return

		const event = await ChannelMessageService.setFeedback(username, groupId, channelId, eventId, type, content)
		res.status(200).json({ event })
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/history-want$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const channelId = req.params[1]
		const { before: rawBefore, limit: rawLimit } = req.body || {}
		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state, member } = membership
		if (!ensureChannel(res, state, channelId)) return
		if (!ensureCanInChannel(res, state, member, PERMISSIONS.VIEW_CHANNEL, channelId, 'No permission to view channel')) return
		const before = String(rawBefore || '').trim() || undefined
		const limit = Math.min(500, Math.max(1, Number(rawLimit) || 50))
		await requestChannelHistoryFromPeers(username, groupId, channelId, { before, limit })
		const messages = await readChannelMessagesForUser(username, groupId, channelId, {
			before: before || undefined,
			limit,
		})
		res.status(200).json({ messages })
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/stream-buffer\/([^/]+)$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const channelId = req.params[1]
		const pendingStreamId = req.params[2]

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { state, member } = membership
		if (!ensureChannel(res, state, channelId)) return
		if (!ensureCanInChannel(res, state, member, PERMISSIONS.VIEW_CHANNEL, channelId, 'No permission to view channel')) return

		const { getBufferedStreamChunks } = await import('../../chat/stream/groupWsStreamBuffer.mjs')
		res.status(200).json({ chunks: getBufferedStreamChunks(groupId, pendingStreamId) })
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/messages$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const channelId = req.params[1]
		const { since, before, limit } = req.query

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state, member } = membership
		if (!ensureChannel(res, state, channelId)) return

		if (!ensureCanInChannel(res, state, member, PERMISSIONS.VIEW_CHANNEL, channelId, 'No permission to view channel')) return

		const messages = await readChannelMessagesForUser(username, groupId, channelId, {
			since: since || undefined,
			before: before || undefined,
			limit,
		})
		const reactionEvents = await readChannelReactionEvents(username, groupId, channelId)
		res.status(200).json({ messages, reactionEvents })
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/messages\/batch-get$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const channelId = req.params[1]
		const rawIds = req.body?.eventIds

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state, member } = membership
		if (!ensureChannel(res, state, channelId)) return
		if (!ensureCanInChannel(res, state, member, PERMISSIONS.VIEW_CHANNEL, channelId, 'No permission to view channel')) return

		if (!Array.isArray(rawIds) || !rawIds.length)
			return res.status(400).json({ error: 'eventIds array required' })
		if (rawIds.length > 500)
			return res.status(400).json({ error: 'eventIds limit 500' })

		/** @type {string[]} */
		const eventIds = []
		for (const raw of rawIds) {
			const id = normalizeHex64(raw)
			if (!isHex64(id)) return res.status(400).json({ error: 'invalid eventId' })
			eventIds.push(id)
		}

		const messages = await readChannelMessagesForUser(username, groupId, channelId, { eventIds })
		const reactionEvents = await readChannelReactionEvents(username, groupId, channelId)
		res.status(200).json({ messages, reactionEvents })
	})

	router.get(new RegExp(`^/api/parts/shells:chat/groups/([^/]+)/channels/([^/]+)/pin-context/(${EVENT_ID_ROUTE_SEGMENT})$`, 'i'), authenticate, async (req, res) => {
		const groupId = req.params[0]
		const channelId = req.params[1]
		const pinEventId = String(req.params[2] || '').toLowerCase()
		if (!CHANNEL_MESSAGE_EVENT_ID_RE.test(pinEventId))
			return res.status(400).json({ error: 'invalid eventId' })

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state, member } = membership
		if (!ensureChannel(res, state, channelId)) return
		if (!ensureCanInChannel(res, state, member, PERMISSIONS.VIEW_CHANNEL, channelId, 'No permission to view channel')) return

		const messages = await readPinNeighborhoodForUser(username, groupId, channelId, pinEventId)
		res.status(200).json({ messages })
	})

	router.put(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/default-channel$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const channelId = String(req.body?.channelId || '').trim()
		if (!channelId)
			return res.status(400).json({ error: 'channelId required' })

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state } = membership
		if (!ensureChannel(res, state, channelId)) return

		await appendSignedLocalEvent(username, groupId, {
			type: 'group_settings_update',
			timestamp: Date.now(),
			content: { defaultChannelId: channelId },
		})
		res.status(200).json({})
	})

	router.put(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/meta$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const { name, description, friendBinding } = req.body || {}
		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username } = membership
		/** @type {Record<string, unknown>} */
		const content = {}
		if (name !== undefined) content.name = name
		if (description !== undefined) content.description = description ?? ''
		if (friendBinding !== undefined) {
			const { normalizeFriendBinding } = await import('../../chat/lib/friendBinding.mjs')
			if (friendBinding === null)
				content.friendBinding = null
			else {
				const normalized = normalizeFriendBinding(friendBinding)
				if (!normalized)
					return res.status(400).json({ error: 'invalid friendBinding' })
				content.friendBinding = normalized
			}
		}

		if (!Object.keys(content).length)
			return res.status(400).json({ error: 'no meta fields to update' })
		await appendSignedLocalEvent(username, groupId, {
			type: 'group_meta_update',
			timestamp: Date.now(),
			content,
		})
		res.status(200).json({})
	})

	router.put(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/settings$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username } = membership
		const { delegatedOwnerPubKeyHash, ...settingsPatch } = req.body || {}
		await appendSignedLocalEvent(username, groupId, {
			type: 'group_settings_update',
			timestamp: Date.now(),
			content: settingsPatch,
		})
		res.status(200).json({})
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels$/, authenticate, requireGroupMember(), async (req, res) => {
		const {
			groupContext: { username, groupId },
			body: { type, name, description, isPrivate }
		} = req
		const channelName = String(name || '').trim()
		if (!channelName)
			return res.status(400).json({ error: 'Channel name is required' })

		const channelId = prefixedRandomId('channel_')
		await appendSignedLocalEvent(username, groupId, {
			type: 'channel_create',
			timestamp: Date.now(),
			content: {
				channelId,
				type: type || 'text',
				name: channelName,
				description: description ?? '',
				isPrivate: isPrivate || false,
			},
		})
		res.status(201).json({ channelId })
	})

	router.put(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const channelId = req.params[1]
		const { name, description, type, isPrivate, parentChannelId } = req.body

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state } = membership
		if (!ensureChannel(res, state, channelId)) return

		const updates = {}
		if (name !== undefined) {
			const trimmed = String(name).trim()
			if (!trimmed)
				return res.status(400).json({ error: 'Channel name cannot be empty' })
			updates.name = trimmed
		}
		if (description !== undefined)
			updates.description = String(description)
		if (type !== undefined)
			updates.type = type
		if (isPrivate !== undefined)
			updates.isPrivate = Boolean(isPrivate)
		if (parentChannelId !== undefined)
			updates.parentChannelId = parentChannelId || null

		if (Object.keys(updates).length === 0)
			return res.status(400).json({ error: 'No channel updates provided' })

		await appendSignedLocalEvent(username, groupId, {
			type: 'channel_update',
			timestamp: Date.now(),
			content: { channelId, updates },
		})
		res.status(200).json({})
	})

	router.delete(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const channelId = req.params[1]

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state } = membership
		if (!ensureChannel(res, state, channelId)) return

		if (state.groupSettings.defaultChannelId === channelId)
			return res.status(400).json({ error: 'Cannot delete default channel' })

		await appendSignedLocalEvent(username, groupId, {
			type: 'channel_delete',
			timestamp: Date.now(),
			content: { channelId },
		})
		res.status(200).json({})
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/votes\/([^/]+)\/cast$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const channelId = req.params[1]
		const ballotId = decodeURIComponent(req.params[2])
		const { choice } = req.body || {}
		if (choice == null)
			return res.status(400).json({ error: 'choice required' })

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state } = membership
		if (!ensureChannel(res, state, channelId)) return
		const event = await appendSignedLocalEvent(username, groupId, {
			type: 'vote_cast',
			channelId,
			timestamp: Date.now(),
			content: { ballotId, choice },
		})
		res.status(201).json({ event })
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/votes$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const channelId = req.params[1]
		const { question: rawQuestion, options: rawOptions, deadline, deadlineMs } = req.body || {}
		const question = String(rawQuestion || '').trim()
		const options = Array.isArray(rawOptions)
			? rawOptions.map(optionLabel => String(optionLabel).trim()).filter(Boolean).slice(0, 12)
			: []
		if (!question) return res.status(400).json({ error: 'question required' })
		if (options.length < 2) return res.status(400).json({ error: 'at least 2 options required' })

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state } = membership
		if (!ensureChannel(res, state, channelId)) return
		let voteDeadline = null
		const deadlineText = String(deadline || '').trim()
		if (deadlineText)
			voteDeadline = deadlineText
		else if (Number.isFinite(Number(deadlineMs)) && Number(deadlineMs) > 0)
			voteDeadline = new Date(Date.now() + Number(deadlineMs)).toISOString()

		const event = await appendSignedLocalEvent(username, groupId, {
			type: 'message',
			channelId,
			timestamp: Date.now(),
			content: { type: 'vote', question, options, deadline: voteDeadline },
		})
		res.status(201).json({ event, ballotId: event.id })
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/messages$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const channelId = req.params[1]
		const { content: rawContent, reply, files: rawFiles } = req.body || {}

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state } = membership
		if (!ensureChannel(res, state, channelId)) return

		const processedFiles = (Array.isArray(rawFiles) ? rawFiles : []).map(file => ({
			...file,
			buffer: Buffer.from(file.buffer, 'base64'),
		}))
		const { event } = await ChannelMessageService.postMessage(username, groupId, channelId, {
			...reply
				? { reply: { content: reply.content, isAutoTrigger: reply.isAutoTrigger } }
				: { rawContent },
			files: processedFiles.length ? processedFiles : undefined,
			maxDagPayloadBytes: Number(state.groupSettings?.maxDagPayloadBytes) || 262_144,
		})
		const { decryptEventContent } = await import('../../chat/channel_keys/content.mjs')
		const result = await decryptEventContent(username, groupId, channelId, event.content)
		const displayContent = result.ok
			? result.content
			: { decryptFailed: true, pendingGeneration: result.generation ?? null }
		const content = displayContent || {}
		const { recordEmojiUsageFromMessageContent } = await import('../../emojiUsage.mjs')
		recordEmojiUsageFromMessageContent(username, content)
		res.status(201).json({ event: { ...event, content: displayContent } })
	})
}
