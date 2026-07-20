/**
 * 【文件】ws/groupWsBroadcast.mjs
 * 【职责】向群 WebSocket 房间广播 JSON 消息，按优先级排队发送；VOLATILE 拥塞时丢弃低优先级；联邦启用时同步 publishVolatileToFederation。
 * 【原理】registerSocket 将 ws 加入 groupSockets Set；broadcastEvent 序列化后 per-socket 微任务队列 flush，cap 48。inferBroadcastPriority：dag_event=0，频道消息=1，stream_chunk 等=4。与联邦出站队列设计对称但独立。
 * 【数据结构】groupSockets: Map<roomKey, Set<WebSocket>>；wsOutboundQueues WeakMap→{ serializedPayload, priority, seq }[]。
 * 【关联】groupWsRooms.mjs、federation/volatile.mjs、session broadcast；npm websocket-express。
 */
import { groupSockets } from './groupWsRooms.mjs'

/** 出站 tie-break（§6.4 优先级：数值越小越优先）。 */
let wsOutSeq = 0
const WS_OUT_CAP = 48
/** @type {WeakMap<import('npm:websocket-express').WebSocket, { serializedPayload: string, priority: number, seq: number }[]>} */
const wsOutboundQueues = new WeakMap()

/**
 * @param {object} payload 广播体
 * @returns {number} 0 DAG、1 频道消息、2 一般、4 VOLATILE（typing / stream_chunk 等）
 */
function inferBroadcastPriority(payload) {
	const type = payload?.type
	if (type === 'dag_event') return 0
	if (type === 'channel_message') return 1
	if (type === 'read_marker') return 2
	if (type === 'stream_chunk') return 2
	if (['typing', 'ai_stream_chunk'].includes(type)) return 4
	return 2
}

/**
 * @param {{ serializedPayload: string, priority: number, seq: number }[]} queue 出站队列
 * @returns {void}
 */
function dropLowestPriorityOutbound(queue) {
	let worstIndex = 0
	for (let index = 1; index < queue.length; index++) {
		const candidate = queue[index]
		const worst = queue[worstIndex]
		if (candidate.priority > worst.priority || (candidate.priority === worst.priority && candidate.seq < worst.seq))
			worstIndex = index
	}
	queue.splice(worstIndex, 1)
}

/**
 * @param {{ serializedPayload: string, priority: number, seq: number }[]} queue 出站队列
 * @param {{ serializedPayload: string, priority: number, seq: number }} item 待插入项
 * @returns {void}
 */
function insertOutboundSorted(queue, item) {
	let lo = 0
	let hi = queue.length
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		const cur = queue[mid]
		const cmp = item.priority !== cur.priority
			? item.priority - cur.priority
			: item.seq - cur.seq
		if (cmp >= 0) lo = mid + 1
		else hi = mid
	}
	queue.splice(lo, 0, item)
}

/**
 * 将 WebSocket 登记到群组房间，连接关闭时自动移除
 * @param {string} groupId 群组 id（与 WS URL 中 groupId 一致）
 * @param {import('npm:websocket-express').WebSocket} ws 已建立的 WS 连接
 * @returns {void}
 */
export function registerSocket(groupId, ws) {
	if (!groupSockets.has(groupId)) groupSockets.set(groupId, new Set())
	groupSockets.get(groupId).add(ws)
	ws.on('close', () => {
		groupSockets.get(groupId)?.delete(ws)
	})
}

/**
 * 当前群在 shell WS 上已连接的客户端数（含 Hub / 群 UI / RPC）。
 * @param {string} groupId 群组 id
 * @returns {number} 连接数，无房间时为 0
 */
export function countGroupSockets(groupId) {
	return groupSockets.get(groupId)?.size ?? 0
}

/**
 * 向某群组下所有已连接 WS 广播 JSON 消息（带时间戳字段 `t`）；拥塞时丢弃低优先级（VOLATILE）。
 * @param {string} groupId 群组 id
 * @param {object} payload 业务负载
 * @returns {void}
 */
function broadcastEventNow(groupId, payload) {
	const sockets = groupSockets.get(groupId)
	if (!sockets) return
	const priority = inferBroadcastPriority(payload)
	const wirePayload = { ...payload }
	delete wirePayload.fedInbound
	const serializedPayload = JSON.stringify({ ...wirePayload, t: Date.now() })
	if (!payload?.fedInbound)
		void import('../federation/index.mjs').then(m => {
			if (m.isFederableVolatilePayload?.(payload))
				return m.publishVolatileToFederation(groupId, payload)
		}).catch(error => console.error('federation: volatile relay failed', error))

	for (const ws of sockets) {
		let queue = wsOutboundQueues.get(ws)
		if (!queue) {
			queue = []
			wsOutboundQueues.set(ws, queue)
		}
		const item = { serializedPayload, priority, seq: ++wsOutSeq }
		insertOutboundSorted(queue, item)
		while (queue.length > WS_OUT_CAP)
			dropLowestPriorityOutbound(queue)
		while (queue.length) {
			const item = queue.shift()
			try {
				ws.send(item.serializedPayload)
			}
			catch (error) {
				console.error('broadcast failed', error)
				queue.unshift(item)
				break
			}
		}
	}
}

/**
 * 向某群组下所有已连接 WS 广播 JSON 消息。
 * `stream_chunk` 在出站前于本机验签（§6.4）；Hub 仅消费已验签的 WS。
 * @param {string} groupId 群组 id
 * @param {object} payload 业务负载
 * @returns {void}
 */
export function broadcastEvent(groupId, payload) {
	if (payload?.type === 'stream_chunk') {
		void import('./signing.mjs').then(async (signing) => {
			if (!await signing.verifyStreamChunkVolatile(payload)) return
			broadcastEventNow(groupId, payload)
		}).catch(error => console.error('broadcast stream_chunk verify failed', error))
		return
	}
	broadcastEventNow(groupId, payload)
}
