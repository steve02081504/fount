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

import { closeWebSocket, runAuthenticatedWs } from './wsAuth.mjs'

/** `ws` WebSocket OPEN readyState 值。 */
const WS_OPEN = 1

/**
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @returns {void}
 */
export function registerWsRoutes(router) {
	router.ws('/ws/parts/shells\\:chat/av-relay/:roomId', authenticate, (ws, req) => {
		const { roomId } = req.params
		if (!roomId) return closeWebSocket(ws, 4400, 'missing room id')
		const colon = roomId.indexOf(':')
		if (colon < 1) return closeWebSocket(ws, 4400, 'invalid room id')
		const groupId = roomId.slice(0, colon)
		const channelId = roomId.slice(colon + 1)
		if (!groupId || !channelId) return closeWebSocket(ws, 4400, 'invalid room id')
		runAuthenticatedWs(ws, req, async ({ username }) => {
			const { getState } = await import('../chat/dag/materialize.mjs')
			const { resolveActiveMemberKeyForLocalUser } = await import('../group/access.mjs')
			const { state } = await getState(username, groupId)
			if (!await resolveActiveMemberKeyForLocalUser(username, groupId, state)) return closeWebSocket(ws, 4403, 'not a member')
			if (!state.channels[channelId]) return closeWebSocket(ws, 4404, 'channel not found')
			registerAvRelaySocket(roomId, ws)
		})
	})

	router.ws('/ws/parts/shells\\:chat/call/:groupId/:channelId', authenticate, (ws, req) => {
		const groupId = req.params.groupId || ''
		const channelId = req.params.channelId || ''
		if (!groupId || !channelId) return closeWebSocket(ws, 4400, 'missing group or channel')
		runAuthenticatedWs(ws, req, async ({ username }) => {
			const { getState } = await import('../chat/dag/materialize.mjs')
			const { resolveActiveMemberKeyForLocalUser } = await import('../group/access.mjs')
			const { resolveOperatorEntityHash } = await import('../chat/lib/replica.mjs')
			const { state } = await getState(username, groupId)
			if (!await resolveActiveMemberKeyForLocalUser(username, groupId, state)) return closeWebSocket(ws, 4403, 'not a member')
			if (!state.channels[channelId]) return closeWebSocket(ws, 4404, 'channel not found')
			const entityHash = await resolveOperatorEntityHash(username)
			if (!entityHash) return closeWebSocket(ws, 4401, 'no entity identity')
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
		if (!ownerNodeHash || !groupId) return closeWebSocket(ws, 4400, 'missing node or group')

		/** 鉴权/成员校验完成前缓冲的入站帧；订阅后原序回放。 */
		/** @type {unknown[]} */
		const pendingFrames = []
		let releasing = false
		/** @type {{ username: string, roomKey: string } | null} */
		let session = null
		/** 串行化帧处理，保持入站顺序。 @type {Promise<void>} */
		let frameChain = Promise.resolve()

		/**
		 * @param {unknown} raw 原始帧
		 * @returns {Promise<void>}
		 */
		async function dispatchFrame(raw) {
			if (!session) return
			const { username, roomKey } = session
			const wireMessage = parseInboundJson(raw)
			if (!wireMessage) return
			if (handleClientWsControlFrame(wireMessage)) return
			if (wireMessage.type === 'typing') {
				const channelId = wireMessage.payload?.channelId
				if (!channelId) return
				const { recordVirtualBridgeTyping } = await import('../chat/bridge/typing.mjs')
				const { resolveOperatorEntityHash } = await import('../chat/lib/replica.mjs')
				const entityHash = await resolveOperatorEntityHash(username)
				if (entityHash)
					recordVirtualBridgeTyping(username, groupId, String(channelId), entityHash)
				return
			}
			if (handleGroupSocketIdentityMessage(ws, wireMessage)) return
			await handleGroupSocketRpcMessage(groupId, roomKey, ws, wireMessage)
		}

		/** @param {unknown} raw 原始帧 @returns {void} */
		function enqueueFrame(raw) {
			frameChain = frameChain
				.then(() => dispatchFrame(raw))
				.catch(error => console.error('[chat ws] group frame failed', error))
		}

		// 同步挂载 message 监听：open 后客户端立即发送的 group_ws_rpc_identity 等首包不会被丢弃。
		ws.on('message', raw => {
			if (!releasing) {
				pendingFrames.push(raw)
				return
			}
			enqueueFrame(raw)
		})

		runAuthenticatedWs(ws, req, async ({ username }) => {
			const { getLocalNodeHash } = await import('../chat/lib/replica.mjs')
			const localNodeHash = getLocalNodeHash()
			if (ownerNodeHash !== localNodeHash) return closeWebSocket(ws, 4403, 'unknown node')
			const { getState } = await import('../chat/dag/materialize.mjs')
			const { resolveActiveMemberKeyForLocalUser } = await import('../group/access.mjs')
			const { state } = await getState(username, groupId)
			if (!await resolveActiveMemberKeyForLocalUser(username, groupId, state))
				return closeWebSocket(ws, 4403, 'not a member')
			if (ws.readyState !== WS_OPEN) return void ws.terminate()
			const { groupWsRoomKey } = await import('../chat/ws/groupWsRooms.mjs')
			session = { username, roomKey: groupWsRoomKey(localNodeHash, groupId) }
			registerGroupUiSocket(username, groupId, ws)
			try {
				ws.send(JSON.stringify({ type: 'subscribed' }))
			}
			catch (error) {
				console.error('[chat ws] failed to send subscribed frame', error)
			}
			// 同步释放缓冲：subscribed 之后到达的新帧无法插到回放之前。
			releasing = true
			for (const raw of pendingFrames.splice(0)) enqueueFrame(raw)
		})
	})
}
