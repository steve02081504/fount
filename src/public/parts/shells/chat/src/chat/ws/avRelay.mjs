/**
 * 【文件】ws/avRelay.mjs
 * 【职责】Hub 音视频二进制帧 WebSocket 透传中继：同房间互转 26 字节头+载荷；可选 entity roster 信令。
 * 【原理】registerAvRelaySocket 按 roomId 分房；入站二进制原样转发；文本 hello 绑定 senderId；广播 peer_count / roster。
 * 【数据结构】帧头 26B：frame_type(0=video 1=audio 2=screen)、flags、seq、captureMs、senderId；rooms Map。
 * 【关联】call / streaming / social live-av WS 路由；不参与 federation/volatile JSON 信封。
 */
import { Buffer } from 'node:buffer'

/**
 * 二进制 AV 帧透传中继（Hub 流媒体 / 通话 / Social 直播）。
 *
 * 帧头格式（前 26 字节）：
 *   [0]     frame_type  0=video 1=audio 2=screen
 *   [1]     flags       bit0=keyframe
 *   [2-5]   seq         uint32 BE
 *   [6-9]   captureMs   uint32 BE（相对本端 session 起点）
 *   [10-25] senderId    16 字节随机 ID（每标签页唯一）
 *   [26+]   编码数据
 *
 * 文本消息：
 *   客户端 → 服务端：{ type: 'hello', senderId: hex32 }
 *   客户端 → 服务端：{ type: 'subscribe', mode: 'full' | 'preview' }
 *   服务端 → 客户端：{ type: 'peer_count', count } / { type: 'roster', peers: [{ entityHash, senderId }] }
 *
 * roomId 惯例：`groupId:channelId`（streaming）/ `groupId:channelId:call`（通话）/ `social:…`
 */

/**
 * AV 中继二进制帧头长度（字节）。
 */
export const AV_RELAY_HEADER_SIZE = 26
/** frame_type：摄像头视频 */
export const AV_FRAME_VIDEO = 0
/** frame_type：音频 */
export const AV_FRAME_AUDIO = 1
/** frame_type：屏幕共享视频轨（客户端约定；服务端透传不区分） */
export const AV_FRAME_SCREEN = 2

/** @type {Map<string, Map<string, object>>} roomId → senderId → publish_meta */
const roomPublishMeta = new Map()
/** @type {Map<string, Set<(text: string) => void>>} */
const roomControlSinks = new Map()

/** 每发送端硬限速（高于此视为异常客户端） */
const HARD_MAX_BPS = 32_000_000
const HARD_MAX_BYTES_PER_SEC = HARD_MAX_BPS / 8

/** preview 模式关键帧转发最短间隔（ms） */
const PREVIEW_KEYFRAME_INTERVAL_MS = 4000

/**
 * @typedef {{ bytesSec: number, resetAt: number, entityHash: string, senderId: string, mode: 'full' | 'preview', lastPreviewAt: number }} AvPeerState
 */

/** @type {Map<string, Map<import('npm:ws').WebSocket, AvPeerState>>} */
const rooms = new Map()

/** 同进程房间桥：roomId → Set of peer roomIds */
const roomBridges = new Map()

/** 外部订阅（跨节点出站）：roomId → Set<(buf) => void> */
const roomSinks = new Map()

/**
 * 订阅房间内所有透传帧（含入站与本房发送）。
 * @param {string} roomId 房间
 * @param {(buf: Buffer) => void} fn 回调
 * @returns {() => void} 取消订阅
 */
export function subscribeAvRelayFrames(roomId, fn) {
	const set = roomSinks.get(roomId) ?? new Set()
	set.add(fn)
	roomSinks.set(roomId, set)
	return () => {
		set.delete(fn)
		if (!set.size) roomSinks.delete(roomId)
	}
}

/**
 * 订阅房间 JSON 控制帧（publish_meta 等），供 live-bridge 出站转发。
 * @param {string} roomId 房间
 * @param {(text: string) => void} fn 回调
 * @returns {() => void} 取消订阅
 */
export function subscribeAvRelayControls(roomId, fn) {
	const set = roomControlSinks.get(roomId) ?? new Set()
	set.add(fn)
	roomControlSinks.set(roomId, set)
	return () => {
		set.delete(fn)
		if (!set.size) roomControlSinks.delete(roomId)
	}
}

/**
 * 注入并广播控制帧（跨节点 bridge 入站）。
 * @param {string} roomId 房间
 * @param {object} controlFrame JSON 体
 * @returns {void}
 */
export function injectAvRelayControl(roomId, controlFrame) {
	applyPublishMeta(roomId, controlFrame)
	const text = JSON.stringify(controlFrame)
	broadcastRoomControl(roomId, text)
}

/**
 * @param {string} roomId 房间
 * @returns {object[]} 已缓存 publish_meta 列表
 */
export function getAvRelayPublishMetaList(roomId) {
	const map = roomPublishMeta.get(roomId)
	if (!map) return []
	return [...map.values()]
}

/**
 * @param {string} roomId 房间
 * @param {object} frame 控制帧
 * @returns {void}
 */
function applyPublishMeta(roomId, frame) {
	if (!frame || typeof frame !== 'object') return
	if (frame.type === 'publish_meta') {
		const senderId = String(frame.senderId || '').toLowerCase()
		if (!/^[0-9a-f]{32}$/.test(senderId)) return
		const map = roomPublishMeta.get(roomId) ?? new Map()
		map.set(senderId, frame)
		roomPublishMeta.set(roomId, map)
		return
	}
	if (frame.type === 'publish_meta_revoke') {
		const senderId = String(frame.senderId || '').toLowerCase()
		roomPublishMeta.get(roomId)?.delete(senderId)
	}
}

/**
 * @param {string} roomId 房间
 * @param {string} text JSON 文本
 * @returns {void}
 */
function broadcastRoomControl(roomId, text) {
	const room = rooms.get(roomId)
	if (room)
		for (const [peer] of room)
			if (peer.readyState === 1) try { peer.send(text) } catch { /* skip */ }
	const sinks = roomControlSinks.get(roomId)
	if (sinks?.size)
		for (const fn of sinks)
			try { fn(text) } catch { /* skip */ }
}

/**
 * @param {import('npm:ws').WebSocket} ws 新加入 peer
 * @param {string} roomId 房间
 * @returns {void}
 */
function sendCachedPublishMeta(ws, roomId) {
	for (const meta of getAvRelayPublishMetaList(roomId)) {
		if (ws.readyState !== 1) return
		try { ws.send(JSON.stringify(meta)) } catch { /* skip */ }
	}
}

/**
 * 同进程双向桥接两个 AV 房间（直播连线同节点）。
 * @param {string} roomIdA 房间 A
 * @param {string} roomIdB 房间 B
 * @returns {() => void} 解除桥接
 */
export function bridgeAvRooms(roomIdA, roomIdB) {
	if (!roomIdA || !roomIdB || roomIdA === roomIdB) return () => { }
	/**
	 * @param {string} from 源房间
	 * @param {string} to 目标房间
	 * @returns {void}
	 */
	const link = (from, to) => {
		const set = roomBridges.get(from) ?? new Set()
		set.add(to)
		roomBridges.set(from, set)
	}
	link(roomIdA, roomIdB)
	link(roomIdB, roomIdA)
	return () => {
		roomBridges.get(roomIdA)?.delete(roomIdB)
		roomBridges.get(roomIdB)?.delete(roomIdA)
		if (!roomBridges.get(roomIdA)?.size) roomBridges.delete(roomIdA)
		if (!roomBridges.get(roomIdB)?.size) roomBridges.delete(roomIdB)
	}
}

/**
 * 向房间注入一帧（跨节点 bridge WS 入站用，不回环到 fromWs）。
 * @param {string} roomId 房间
 * @param {Buffer | ArrayBuffer | Uint8Array} data 二进制帧
 * @param {import('npm:ws').WebSocket | null} [fromWs] 来源（跳过）
 * @returns {void}
 */
export function injectAvRelayFrame(roomId, data, fromWs = null) {
	const room = rooms.get(roomId)
	if (!room) return
	const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
	if (buf.length < AV_RELAY_HEADER_SIZE) return
	fanoutBinary(roomId, room, buf, fromWs, { skipSinks: true })
}

/**
 * @param {string} roomId 房间 ID
 * @returns {Map<import('npm:ws').WebSocket, AvPeerState> | undefined} 房间成员
 */
export function getAvRelayRoom(roomId) {
	return rooms.get(roomId)
}

/**
 * @param {string} roomId 房间 ID
 * @returns {{ entityHash: string, senderId: string }[]} 当前 roster（有 entityHash 的 peer）
 */
export function getAvRelayRoster(roomId) {
	const room = rooms.get(roomId)
	if (!room) return []
	const peers = []
	for (const state of room.values()) {
		if (!state.entityHash) continue
		peers.push({ entityHash: state.entityHash, senderId: state.senderId || '' })
	}
	return peers
}

/**
 * @param {string} roomId 房间 ID
 * @returns {number} 连接数
 */
export function getAvRelayPeerCount(roomId) {
	return rooms.get(roomId)?.size || 0
}

/**
 * 将 WebSocket 注册到 AV 中继房间，连接关闭时自动移除。
 * @param {string} roomId 房间 ID
 * @param {import('npm:ws').WebSocket} ws 已建立的 WS 连接
 * @param {{ entityHash?: string, onRosterChange?: (roster: { entityHash: string, senderId: string }[]) => void, onRoomEmpty?: () => void, onFirstPeer?: (entityHash: string) => void }} [meta] 可选元数据与生命周期钩子
 * @returns {void}
 */
export function registerAvRelaySocket(roomId, ws, meta = {}) {
	const entityHash = String(meta.entityHash || '').trim().toLowerCase()
	const wasEmpty = !rooms.has(roomId) || rooms.get(roomId).size === 0
	if (!rooms.has(roomId)) rooms.set(roomId, new Map())
	const room = rooms.get(roomId)

	room.set(ws, {
		bytesSec: 0,
		resetAt: Date.now() + 1000,
		entityHash,
		senderId: '',
		mode: 'full',
		lastPreviewAt: 0,
	})
	sendCachedPublishMeta(ws, roomId)
	broadcastPeerCount(room)
	if (entityHash) broadcastRoster(room)
	if (wasEmpty && entityHash && typeof meta.onFirstPeer === 'function')
		meta.onFirstPeer(entityHash)
	else if (entityHash && typeof meta.onRosterChange === 'function')
		meta.onRosterChange(getAvRelayRoster(roomId))

	ws.on('message', (data, isBinary) => {
		if (!isBinary) {
			handleTextControl(roomId, room, ws, data, meta)
			return
		}
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

		fanoutBinary(roomId, room, buf, ws)
	})

	ws.on('close', () => {
		const state = room.get(ws)
		if (state?.senderId) {
			const revoke = { type: 'publish_meta_revoke', senderId: state.senderId }
			applyPublishMeta(roomId, revoke)
			broadcastRoomControl(roomId, JSON.stringify(revoke))
		}
		room.delete(ws)
		if (!room.size) {
			roomPublishMeta.delete(roomId)
			rooms.delete(roomId)
			if (typeof meta.onRoomEmpty === 'function') meta.onRoomEmpty()
			return
		}
		broadcastPeerCount(room)
		if (entityHash) {
			broadcastRoster(room)
			if (typeof meta.onRosterChange === 'function')
				meta.onRosterChange(getAvRelayRoster(roomId))
		}
	})
}

/**
 * @param {string} roomId 本房间
 * @param {Map<import('npm:ws').WebSocket, AvPeerState>} room 成员
 * @param {Buffer} buf 帧
 * @param {import('npm:ws').WebSocket | null} fromWs 来源
 * @param {{ skipSinks?: boolean }} [options] 选项
 * @returns {void}
 */
function fanoutBinary(roomId, room, buf, fromWs, options = {}) {
	const frameType = buf.length >= AV_RELAY_HEADER_SIZE ? buf[0] : -1
	const isKey = buf.length >= AV_RELAY_HEADER_SIZE ? !!(buf[1] & 1) : false
	const now = Date.now()
	for (const [peer, peerState] of room) {
		if (peer === fromWs || peer.readyState !== 1) continue
		if (peerState.mode === 'preview') {
			if (frameType !== 0 || !isKey) continue
			if (now - (peerState.lastPreviewAt || 0) < PREVIEW_KEYFRAME_INTERVAL_MS) continue
			peerState.lastPreviewAt = now
		}
		try { peer.send(buf, { binary: true }) }
		catch { /* skip failed send */ }
	}
	const bridged = roomBridges.get(roomId)
	if (bridged?.size) 
		for (const otherId of bridged) {
			const other = rooms.get(otherId)
			if (!other) continue
			for (const [peer, peerState] of other) {
				if (peer.readyState !== 1) continue
				if (peerState.mode === 'preview') {
					if (frameType !== 0 || !isKey) continue
					if (now - (peerState.lastPreviewAt || 0) < PREVIEW_KEYFRAME_INTERVAL_MS) continue
					peerState.lastPreviewAt = now
				}
				try { peer.send(buf, { binary: true }) }
				catch { /* skip */ }
			}
		}
	
	if (options.skipSinks) return
	const sinks = roomSinks.get(roomId)
	if (sinks?.size)
		for (const fn of sinks)
			try { fn(buf) } catch { /* skip */ }
}

/**
 * @param {string} roomId 房间
 * @param {Map<import('npm:ws').WebSocket, AvPeerState>} room 成员
 * @param {import('npm:ws').WebSocket} ws 来源
 * @param {unknown} data 原始文本
 * @param {{ onRosterChange?: (roster: { entityHash: string, senderId: string }[]) => void }} meta 钩子
 * @returns {void}
 */
function handleTextControl(roomId, room, ws, data, meta) {
	let controlFrame
	try { controlFrame = JSON.parse(String(data)) }
	catch { return }
	if (!controlFrame || typeof controlFrame !== 'object') return
	const state = room.get(ws)
	if (!state) return

	if (controlFrame.type === 'subscribe') {
		const mode = String(controlFrame.mode || '').trim().toLowerCase()
		if (mode === 'preview' || mode === 'full') {
			state.mode = mode
			if (mode === 'full') state.lastPreviewAt = 0
		}
		return
	}

	if (controlFrame.type === 'publish_meta' || controlFrame.type === 'publish_meta_revoke') {
		const senderId = String(controlFrame.senderId || '').trim().toLowerCase()
		if (!/^[0-9a-f]{32}$/.test(senderId)) return
		if (controlFrame.type === 'publish_meta' && state.senderId && senderId !== state.senderId) return
		applyPublishMeta(roomId, controlFrame)
		broadcastRoomControl(roomId, JSON.stringify(controlFrame))
		return
	}

	if (controlFrame.type !== 'hello') return
	const senderId = String(controlFrame.senderId || '').trim().toLowerCase()
	if (!/^[0-9a-f]{32}$/.test(senderId)) return
	state.senderId = senderId
	if (state.entityHash) {
		broadcastRoster(room)
		if (typeof meta.onRosterChange === 'function')
			meta.onRosterChange(getAvRelayRoster(roomId))
	}
}

/**
 * @param {Map<import('npm:ws').WebSocket, AvPeerState>} room 房间成员 Map
 * @returns {void}
 */
function broadcastPeerCount(room) {
	const peerCountWireText = JSON.stringify({ type: 'peer_count', count: room.size })
	for (const [ws] of room)
		if (ws.readyState === 1) try { ws.send(peerCountWireText) } catch { /* skip */ }
}

/**
 * @param {Map<import('npm:ws').WebSocket, AvPeerState>} room 房间成员 Map
 * @returns {void}
 */
function broadcastRoster(room) {
	const peers = []
	for (const state of room.values()) {
		if (!state.entityHash) continue
		peers.push({ entityHash: state.entityHash, senderId: state.senderId || '' })
	}
	const text = JSON.stringify({ type: 'roster', peers })
	for (const [ws] of room)
		if (ws.readyState === 1) try { ws.send(text) } catch { /* skip */ }
}
