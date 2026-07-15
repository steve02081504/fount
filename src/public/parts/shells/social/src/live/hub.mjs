/**
 * 直播间 JSON 信令 Hub：弹幕 / 点赞 / 观众数 / 连线转发。
 */
import { appendLiveDanmaku, loadLiveSession, patchLiveStats } from './session.mjs'

/** @type {Map<string, Set<import('npm:ws').WebSocket>>} */
const liveRooms = new Map()

/** 连线对端房间桥：roomKey → peer roomKey */
const signalBridges = new Map()

/**
 * @param {string} entityHash 主播
 * @param {string} liveId 直播
 * @returns {string} room key
 */
export function liveSignalRoomKey(entityHash, liveId) {
	return `${entityHash.toLowerCase()}:${String(liveId).toLowerCase()}`
}

/**
 * @param {string} entityHash 主播
 * @param {string} liveId 直播
 * @param {import('npm:ws').WebSocket} socket WS
 * @param {{ username: string, viewerEntityHash: string }} meta 元数据
 * @returns {void}
 */
export function registerLiveSignalSocket(entityHash, liveId, socket, meta) {
	const key = liveSignalRoomKey(entityHash, liveId)
	const set = liveRooms.get(key) ?? new Set()
	set.add(socket)
	liveRooms.set(key, set)
	socket.liveMeta = meta
	broadcast(key, { type: 'viewer_count', count: set.size })
	const session = patchLiveStats(meta.username, entityHash, liveId, {
		viewerCount: set.size,
		viewerEntityHash: meta.viewerEntityHash,
	})
	if (session)
		broadcast(key, { type: 'like_count', count: session.likeCount || 0 })

	socket.on('message', raw => {
		let msg
		try { msg = JSON.parse(String(raw)) }
		catch { return }
		if (!msg || typeof msg !== 'object') return
		if (msg.type === 'danmaku') {
			const text = String(msg.text || '').trim().slice(0, 120)
			if (!text) return
			const row = {
				type: 'danmaku',
				text,
				entityHash: meta.viewerEntityHash,
				at: Date.now(),
				origin: key,
			}
			appendLiveDanmaku(meta.username, entityHash, liveId, row)
			broadcast(key, row)
			forwardBridged(key, row)
			return
		}
		if (msg.type === 'like') {
			const updated = patchLiveStats(meta.username, entityHash, liveId, { likeDelta: 1 })
			const row = {
				type: 'like',
				entityHash: meta.viewerEntityHash,
				at: Date.now(),
				origin: key,
			}
			broadcast(key, row)
			if (updated) {
				broadcast(key, { type: 'like_count', count: updated.likeCount || 0 })
				forwardBridged(key, { type: 'like_count', count: updated.likeCount || 0, origin: key })
			}
			forwardBridged(key, row)
		}
	})

	socket.on('close', () => {
		set.delete(socket)
		if (!set.size) liveRooms.delete(key)
		else broadcast(key, { type: 'viewer_count', count: set.size })
		patchLiveStats(meta.username, entityHash, liveId, { viewerCount: set.size })
		forwardBridged(key, { type: 'viewer_count', count: set.size, origin: key })
	})
}

/**
 * 同节点连线：合并两个信令房间双向转发。
 * @param {string} keyA room key
 * @param {string} keyB room key
 * @returns {() => void} teardown
 */
export function bridgeLiveSignalRooms(keyA, keyB) {
	if (!keyA || !keyB || keyA === keyB) return () => { }
	signalBridges.set(keyA, keyB)
	signalBridges.set(keyB, keyA)
	return () => {
		if (signalBridges.get(keyA) === keyB) signalBridges.delete(keyA)
		if (signalBridges.get(keyB) === keyA) signalBridges.delete(keyB)
	}
}

/**
 * @param {string} key room key
 * @param {object} payload 推送
 * @returns {void}
 */
export function broadcastLiveSignal(key, payload) {
	broadcast(key, payload)
}

/**
 * 注入对端连线信令（来自 bridge WS），抑制回环。
 * @param {string} username replica
 * @param {string} entityHash 主播
 * @param {string} liveId 直播
 * @param {object} payload 载荷
 * @returns {void}
 */
export function ingestBridgedLiveSignal(username, entityHash, liveId, payload) {
	const key = liveSignalRoomKey(entityHash, liveId)
	if (!payload || typeof payload !== 'object') return
	const origin = String(payload.origin || '')
	if (origin === key) return
	if (payload.type === 'danmaku' && payload.text) {
		appendLiveDanmaku(username, entityHash, liveId, { ...payload, bridged: true })
		broadcast(key, { ...payload, bridged: true })
		return
	}
	if (payload.type === 'like') {
		broadcast(key, { ...payload, bridged: true })
		return
	}
	if (payload.type === 'like_count' || payload.type === 'viewer_count' || payload.type === 'link_stats') {
		broadcast(key, { ...payload, bridged: true })
		return
	}
	if (payload.type === 'link_ended')
		broadcast(key, payload)
}

/**
 * @param {string} key room key
 * @param {object} payload 推送
 * @returns {void}
 */
function forwardBridged(key, payload) {
	const peer = signalBridges.get(key)
	if (!peer) return
	if (payload.origin && payload.origin !== key) return
	broadcast(peer, { ...payload, origin: key })
}

/**
 * @param {string} key room key
 * @param {object} payload 推送
 * @returns {void}
 */
function broadcast(key, payload) {
	const set = liveRooms.get(key)
	if (!set) return
	const text = JSON.stringify(payload)
	for (const socket of set)
		if (socket.readyState === 1)
			try { socket.send(text) } catch { /* skip */ }
}

/**
 * @param {string} username replica
 * @param {string} entityHash 主播
 * @param {string} liveId 直播
 * @param {string} viewerEntityHash 观看者
 * @returns {boolean} 是否允许进入
 */
export function canJoinLiveRoom(username, entityHash, liveId, viewerEntityHash) {
	const session = loadLiveSession(username, entityHash, liveId)
	if (!session || session.status !== 'live') return false
	if (session.federatedProxy) return true
	if (session.visibility !== 'followers') return true
	void viewerEntityHash
	return true
}

/**
 * @param {string} entityHash 主播
 * @param {string} liveId 直播
 * @returns {number} 当前观众连接数
 */
export function getLiveSignalViewerCount(entityHash, liveId) {
	return liveRooms.get(liveSignalRoomKey(entityHash, liveId))?.size || 0
}
