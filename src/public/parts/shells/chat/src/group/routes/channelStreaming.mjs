/**
 * 【文件】group/routes/channelStreaming.mjs
 * 【职责】频道 HTTP 路由（流媒体鉴权与嵌入）。
 * 【关联】被 channels.mjs 聚合注册。
 */
import { PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'
import { resolveIceServers } from 'npm:@steve02081504/fount-p2p/transport/ice_servers'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { appendStreamingSession } from '../../chat/dag/channelOperations.mjs'
import { getCurrentFileMasterKey } from '../../chat/file_keys/store.mjs'
import { buildStreamingEmbedUrl, mintStreamingViewToken } from '../../chat/ws/auth.mjs'
import { startWhipIngest, stopWhipIngest } from '../../chat/whip/ingest.mjs'

import {
	ensureCanInChannel,
	ensureCanInChannelSend,
	requireGroupMember,
} from './middleware.mjs'
import { GROUPS_PREFIX } from './path.mjs'


/**
 * 注册频道 流媒体鉴权与嵌入 HTTP 路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerChannelStreamingRoutes(router, authenticate) {
	router.get(`${GROUPS_PREFIX}/:groupId/channels/:channelId/streaming-view`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, state, member, groupId } = req.groupContext
		const { channelId } = req.params
		const channel = state.channels[channelId]
		if (!channel)
			throw httpError(404, 'Channel not found')
		if (channel.type !== 'streaming')
			throw httpError(400, 'Channel is not a streaming channel')

		ensureCanInChannelSend(state, member, PERMISSIONS.VIEW_CHANNEL, channelId, 'VIEW_CHANNEL denied')

		const baseUrl = state.groupSettings?.streamingSfuWss?.trim() || ''
		if (!baseUrl)
			throw httpError(404, 'External SFU not configured')

		const keyEntry = await getCurrentFileMasterKey(username, groupId)
		if (!keyEntry?.fileMasterKey)
			throw httpError(400, 'Group encryption (GSH) not initialized')

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

	router.post(`${GROUPS_PREFIX}/:groupId/channels/:channelId/streaming-auth`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, state, member, groupId } = req.groupContext
		const { channelId } = req.params
		const channel = state.channels[channelId]
		if (!channel)
			throw httpError(404, 'Channel not found')
		if (channel.type !== 'streaming')
			throw httpError(400, 'Channel is not a streaming channel')

		ensureCanInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId, 'VIEW_CHANNEL denied')

		const baseUrl = state.groupSettings?.streamingSfuWss?.trim() || ''
		if (!baseUrl)
			return res.status(200).json({ mode: 'webrtc', iceServers: resolveIceServers(state.groupSettings) })

		const keyEntry = await getCurrentFileMasterKey(username, groupId)
		if (!keyEntry?.fileMasterKey)
			throw httpError(400, 'Group encryption (GSH) not initialized')

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

	router.post(`${GROUPS_PREFIX}/:groupId/channels/:channelId/whip`, authenticate, requireGroupMember(), async (req, res) => {
		const { state, member, groupId } = req.groupContext
		const { channelId } = req.params
		const channel = state.channels[channelId]
		if (!channel) throw httpError(404, 'Channel not found')
		if (channel.type !== 'streaming') throw httpError(400, 'Channel is not a streaming channel')
		ensureCanInChannelSend(state, member, PERMISSIONS.SEND_MESSAGES, channelId, 'SEND denied')
		const offerSdp = typeof req.body === 'string' ? req.body : String(req.body?.sdp || req.body || '')
		if (!offerSdp.includes('v=0')) throw httpError(400, 'sdp required')
		const roomId = `${groupId}:${channelId}`
		const { answerSdp } = await startWhipIngest(roomId, offerSdp)
		res.status(201).type('application/sdp').send(answerSdp)
	})

	router.delete(`${GROUPS_PREFIX}/:groupId/channels/:channelId/whip`, authenticate, requireGroupMember(), async (req, res) => {
		const { groupId } = req.groupContext
		const { channelId } = req.params
		stopWhipIngest(`${groupId}:${channelId}`)
		res.status(200).json({ ok: true })
	})

}
