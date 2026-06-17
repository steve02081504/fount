import { normalizeHex64 } from '../../../../../../scripts/p2p/hexIds.mjs'
import { parseInboundJson } from '../../../../../../scripts/p2p/wire_ingress.mjs'
import { authenticate } from '../../../../../../server/auth.mjs'
import {
	handleClientWsControlFrame,
	registerGroupUiSocket,
	relayClientWebRtcSignal,
} from '../chat/session/wsLifecycle.mjs'
import { registerAvRelaySocket } from '../chat/stream/avRelay.mjs'
import {
	handleGroupSocketIdentityMessage,
	handleGroupSocketRpcMessage,
} from '../chat/stream/groupWsHub.mjs'
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

	router.ws('/ws/parts/shells\\:chat/groups/:ownerNodeHash/:groupId', authenticate, (ws, req) => {
		const { ownerNodeHash, groupId } = req.params
		if (!ownerNodeHash || !groupId) return void ws.close()
		runAuthenticatedWs(ws, req, async ({ username }) => {
			const { getLocalNodeHash } = await import('../chat/lib/replica.mjs')
			const localNodeHash = getNodeHash()
			if (normalizeHex64(ownerNodeHash) !== localNodeHash) return void ws.close()
			const { getState } = await import('../chat/dag/materialize.mjs')
			const { resolveActiveMemberKeyForLocalUser } = await import('../group/access.mjs')
			const { groupWsRoomKey } = await import('../chat/stream/groupWsRooms.mjs')
			const { state } = await getState(username, groupId)
			if (!await resolveActiveMemberKeyForLocalUser(username, groupId, state)) return void ws.close()
			const roomKey = groupWsRoomKey(localNodeHash, groupId)
			registerGroupUiSocket(username, groupId, ws)
			ws.on('message', raw => {
				const wireMessage = parseInboundJson(raw)
				if (!wireMessage) return
				if (handleClientWsControlFrame(wireMessage)) return
				if (relayClientWebRtcSignal(roomKey, wireMessage)) return
				if (handleGroupSocketIdentityMessage(ws, wireMessage)) return
				void handleGroupSocketRpcMessage(groupId, roomKey, ws, wireMessage)
			})
		})
	})
}
