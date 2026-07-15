/**
 * 直播间 JSON 信令 Hub：弹幕 / 点赞特效 / 观众数。
 */
import { appendLiveDanmaku, loadLiveSession } from './session.mjs'

/** @type {Map<string, Set<import('npm:ws').WebSocket>>} */
const liveRooms = new Map()

/**
 * @param {string} entityHash 主播
 * @param {string} liveId 直播
 * @returns {string} room key
 */
function roomKey(entityHash, liveId) {
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
	const key = roomKey(entityHash, liveId)
	const set = liveRooms.get(key) ?? new Set()
	set.add(socket)
	liveRooms.set(key, set)
	socket.liveMeta = meta
	broadcast(key, { type: 'viewer_count', count: set.size })

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
			}
			appendLiveDanmaku(meta.username, entityHash, liveId, row)
			broadcast(key, row)
			return
		}
		if (msg.type === 'like') {
			broadcast(key, {
				type: 'like',
				entityHash: meta.viewerEntityHash,
				at: Date.now(),
			})
		}
	})

	socket.on('close', () => {
		set.delete(socket)
		if (!set.size) liveRooms.delete(key)
		else broadcast(key, { type: 'viewer_count', count: set.size })
	})
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
	if (session.visibility !== 'followers') return true
	// followers 鉴权在 endpoint 侧检查 following
	void viewerEntityHash
	return true
}
