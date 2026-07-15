import { normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { parseInboundJson } from 'npm:@steve02081504/fount-p2p/wire/ingress'

import { authenticate } from '../../../../../../server/auth/index.mjs'
import {
	beginCallSession,
	callRoomId,
	endCallSession,
	updateCallRoster,
} from '../chat/call/session.mjs'
import {
	handleClientWsControlFrame,
	registerGroupUiSocket,
} from '../chat/session/wsLifecycle.mjs'
import { registerAvRelaySocket } from '../chat/ws/avRelay.mjs'
import {
	handleGroupSocketIdentityMessage,
	handleGroupSocketRpcMessage,
} from '../chat/ws/groupWsRpc.mjs'
import { runAuthenticatedWs } from '../ws_auth.mjs'

/**
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @returns {void}
 */
export function registerWsRoutes(router) {
	router.ws('/ws/parts/shells\\:chat/av-relay/:roomId', authenticate, (ws, req) => {
		const { roomId } = req.params
		if (!roomId) return void ws.close()
		const colon = roomId.indexOf(':')
		if (colon < 1) return void ws.close()
		const groupId = roomId.slice(0, colon)
		const channelId = roomId.slice(colon + 1)
		if (!groupId || !channelId) return void ws.close()
		runAuthenticatedWs(ws, req, async ({ username }) => {
			const { getState } = await import('../chat/dag/materialize.mjs')
			const { resolveActiveMemberKeyForLocalUser } = await import('../group/access.mjs')
			const { state } = await getState(username, groupId)
			if (!await resolveActiveMemberKeyForLocalUser(username, groupId, state)) return void ws.close()
			if (!state.channels[channelId]) return void ws.close()
			registerAvRelaySocket(roomId, ws)
		})
	})

	router.ws('/ws/parts/shells\\:chat/call/:groupId/:channelId', authenticate, (ws, req) => {
		const groupId = String(req.params.groupId || '')
		const channelId = String(req.params.channelId || '')
		if (!groupId || !channelId) return void ws.close()
		runAuthenticatedWs(ws, req, async ({ username }) => {
			const { getState } = await import('../chat/dag/materialize.mjs')
			const { resolveActiveMemberKeyForLocalUser } = await import('../group/access.mjs')
			const { resolveOperatorEntityHash } = await import('../chat/lib/replica.mjs')
			const { state } = await getState(username, groupId)
			if (!await resolveActiveMemberKeyForLocalUser(username, groupId, state)) return void ws.close()
			if (!state.channels[channelId]) return void ws.close()
			const entityHash = await resolveOperatorEntityHash(username)
			if (!entityHash) return void ws.close()
			const roomId = callRoomId(groupId, channelId)
			registerAvRelaySocket(roomId, ws, {
				entityHash,
				/**
				 * @param {string} hash 首个入房 entityHash
				 * @returns {void}
				 */
				onFirstPeer: hash => {
					void beginCallSession(username, groupId, channelId, hash)
						.catch(error => console.error('call: begin failed', error))
				},
				/**
				 * @param {{ entityHash: string, senderId: string }[]} roster roster
				 * @returns {void}
				 */
				onRosterChange: roster => {
					void updateCallRoster(groupId, channelId, roster)
						.catch(error => console.error('call: roster update failed', error))
				},
				/**
				 * @returns {void}
				 */
				onRoomEmpty: () => {
					void endCallSession(groupId, channelId)
						.catch(error => console.error('call: end failed', error))
				},
			})
		})
	})

	router.ws('/ws/parts/shells\\:chat/groups/:ownerNodeHash/:groupId', authenticate, (ws, req) => {
		const { ownerNodeHash, groupId } = req.params
		if (!ownerNodeHash || !groupId) return void ws.close()
		runAuthenticatedWs(ws, req, async ({ username }) => {
			const { getLocalNodeHash } = await import('../chat/lib/replica.mjs')
			const localNodeHash = getLocalNodeHash()
			if (normalizeHex64(ownerNodeHash) !== localNodeHash) return void ws.close()
			const { getState } = await import('../chat/dag/materialize.mjs')
			const { resolveActiveMemberKeyForLocalUser } = await import('../group/access.mjs')
			const { groupWsRoomKey } = await import('../chat/ws/groupWsRooms.mjs')
			const { state } = await getState(username, groupId)
			if (!await resolveActiveMemberKeyForLocalUser(username, groupId, state)) return void ws.close()
			const roomKey = groupWsRoomKey(localNodeHash, groupId)
			registerGroupUiSocket(username, groupId, ws)
			ws.on('message', raw => {
				const wireMessage = parseInboundJson(raw)
				if (!wireMessage) return
				if (handleClientWsControlFrame(wireMessage)) return
				if (wireMessage.type === 'typing') {
					void (async () => {
						const { recordChannelTyping } = await import('../chat/bridge/typing.mjs')
						const { resolveOperatorEntityHash } = await import('../chat/lib/replica.mjs')
						const entityHash = await resolveOperatorEntityHash(username)
						if (entityHash)
							recordChannelTyping(username, groupId, String(wireMessage.payload?.channelId || 'default'), entityHash)
					})()
					return
				}
				if (handleGroupSocketIdentityMessage(ws, wireMessage)) return
				void handleGroupSocketRpcMessage(groupId, roomKey, ws, wireMessage)
			})
		})
	})
}
