import { attachGroupPartWire } from 'npm:@steve02081504/fount-p2p/wire/group_part'
import { wireAction } from 'npm:@steve02081504/fount-p2p/transport/room_wire_action'
import { isFederationActionAllowedUnderLoad } from 'npm:@steve02081504/fount-p2p/transport/rtc_connection_budget'
import { isPlainObject } from 'npm:@steve02081504/fount-p2p/wire/ingress'
import { encodeWireJson } from '../../lib/wireJson.mjs'
import {
	buildRpcErrorResponse,
	parseCharRpcRequest,
	safeSendCharRpcResponse,
} from '../charRpc.mjs'
import { attachTrustGraphChunkHandlers } from '../chunks.mjs'


/**
 * char RPC、part_invoke、TrustGraph chunk handler。
 * @param {import('./roomContext.mjs').FederationRpcContext} roomContext 房间上下文
 * @returns {void}
 */
export function registerRpcHandlers(roomContext) {
	const {
		username,
		groupId,
		key,
		room,
		fedOut,
		rtcLimits,
		getActionSender,
		getActionReceiver,
	} = roomContext

	/**
	 * @param {string} name action
	 * @param {unknown} payload 载荷
	 * @param {string | null} peerId 目标 peer
	 * @returns {void}
	 */
	function sendGroupPartAction(name, payload, peerId) {
		getActionSender(name)(payload, peerId)
	}
	/**
	 * @param {string} name action
	 * @param {(payload: unknown, peerId: string) => void} handler 处理器
	 * @returns {void}
	 */
	function onGroupPartAction(name, handler) {
		getActionReceiver(name)(handler)
	}
	attachGroupPartWire({ replicaUsername: username }, groupId, { send: sendGroupPartAction, on: onGroupPartAction }, {
		/** @returns {boolean} 过载时是否仍接受 part_invoke */
		allowPartInvoke: () => isFederationActionAllowedUnderLoad(key, 'part_invoke', rtcLimits),
	})

	attachTrustGraphChunkHandlers(username, room, fedOut, rtcLimits, key)

	const charRpc = wireAction(roomContext, 'char_rpc')
	const charRpcResponse = wireAction(roomContext, 'char_rpc_response')

	charRpc.on((data, peerId) => {
		const request = parseCharRpcRequest(data)
		if (!request) return
		const { requestId, memberId, method, args } = request
		void (async () => {
			const isWorld = memberId.includes(':world:')
			const { tryInvokeLocalCharRpc, tryInvokeLocalWorldRpc } = await import('../../session.mjs')
			const result = isWorld
				? await tryInvokeLocalWorldRpc(groupId, memberId, method, args)
				: await tryInvokeLocalCharRpc(groupId, memberId, method, args)
			if (result.kind === 'not_local') return
			safeSendCharRpcResponse(
				charRpcResponse.send,
				result.kind === 'result'
					? {
						type: 'rpc_end',
						requestId,
						result: encodeWireJson(result.value, `federation.char_rpc.result:${method}`),
					}
					: buildRpcErrorResponse(
						requestId,
						result.kind === 'method_not_found' ? 'method not found' : String(result.message || 'execution failed'),
						result.kind === 'method_not_found' ? 'METHOD_NOT_FOUND' : result.code,
					),
				peerId,
			)
		})().catch(error => {
			safeSendCharRpcResponse(
				charRpcResponse.send,
				buildRpcErrorResponse(requestId, String(error?.message || error), error?.code),
				peerId,
			)
		})
	})
	charRpcResponse.on(data => {
		if (!isPlainObject(data)) return
		void import('../../ws/groupWsRpc.mjs').then(({ relayOrConsumeRpcResponse }) => {
			relayOrConsumeRpcResponse(data)
		}).catch(console.error)
	})

}
