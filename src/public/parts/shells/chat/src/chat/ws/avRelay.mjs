/**
 * 【文件】ws/avRelay.mjs
 * 【职责】Hub 音视频频道二进制帧 WebSocket 透传中继（非 JSON DAG）：同房间多客户端互转 26 字节头+载荷，附带简单带宽计数。
 * 【原理】registerAvRelaySocket 按 roomId 分房；入站二进制帧原样转发同房其他 ws；文本控制消息 peer_count。与群 JSON WS、Trystero P2P 分离，降低 AV 延迟。
 * 【数据结构】帧头 26B：frame_type、flags、seq、captureMs 等；rooms Map<roomId, Map<ws,{bytesSec,resetAt}>>。
 * 【关联】独立 AV WS 路由；ws/auth 令牌鉴权观看侧；不参与 federation/volatile JSON 信封。
 */
import { Buffer } from 'node:buffer'

/**
 * 二进制 AV 帧透传中继（Hub 流媒体频道）。
 *
 * 帧头格式（前 26 字节）：
 *   [0]     frame_type  0=video 1=audio
 *   [1]     flags       bit0=keyframe
 *   [2-5]   seq         uint32 BE
 *   [6-9]   captureMs   uint32 BE（相对本端 session 起点）
 *   [10-25] senderId    16 字节随机 ID（每标签页唯一）
 *   [26+]   编码数据
 *
 * 文本消息（服务端 → 客户端）：
 *   { type: 'peer_count', count: number }
 *
 * roomId 格式：`groupId:channelId`
 */

/**
 * AV 中继二进制帧头长度（字节）。
 */
export const AV_RELAY_HEADER_SIZE = 26

/** 每发送端硬限速（高于此视为异常客户端） */
const HARD_MAX_BPS = 32_000_000   // 32 Mbps
const HARD_MAX_BYTES_PER_SEC = HARD_MAX_BPS / 8

/** @type {Map<string, Map<import('npm:ws').WebSocket, { bytesSec: number, resetAt: number }>>} */
const rooms = new Map()

/**
 * 将 WebSocket 注册到 AV 中继房间，连接关闭时自动移除。
 * @param {string} roomId 房间 ID（groupId:channelId）
 * @param {import('npm:ws').WebSocket} ws 已建立的 WS 连接
 * @returns {void}
 */
export function registerAvRelaySocket(roomId, ws) {
	if (!rooms.has(roomId)) rooms.set(roomId, new Map())
	const room = rooms.get(roomId)

	room.set(ws, { bytesSec: 0, resetAt: Date.now() + 1000 })
	broadcastPeerCount(room)

	ws.on('message', (data, isBinary) => {
		if (!isBinary) return
		const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
		if (buf.length < AV_RELAY_HEADER_SIZE) return

		const senderState = room.get(ws)
		if (!senderState) return

		const now = Date.now()
		if (now > senderState.resetAt) {
			senderState.bytesSec = 0
			senderState.resetAt = now + 1000
		}
		senderState.bytesSec += buf.length
		if (senderState.bytesSec > HARD_MAX_BYTES_PER_SEC) return

		for (const [peer] of room) {
			if (peer === ws || peer.readyState !== 1) continue
			try { peer.send(buf, { binary: true }) }
			catch { /* skip failed send */ }
		}
	})

	ws.on('close', () => {
		room.delete(ws)
		if (!room.size) rooms.delete(roomId)
		else broadcastPeerCount(room)
	})
}

/**
 * @param {Map<import('npm:ws').WebSocket, unknown>} room 房间成员 Map
 * @returns {void}
 */
function broadcastPeerCount(room) {
	const peerCountWireText = JSON.stringify({ type: 'peer_count', count: room.size })
	for (const [ws] of room)
		if (ws.readyState === 1) try { ws.send(peerCountWireText) } catch { /* skip */ }
}
