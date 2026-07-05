import { resolvePendingChunkFetch } from '../chunk_fetch_pending.mjs'
import { handleIncomingChunkGet } from './chunk_fetch.mjs'

/**
 * @param {string} username replica 用户名
 * @param {object} data 入站 fed_chunk_get
 * @param {string} peerId 对端 id
 * @param {(resp: object, peerId: string) => void} sendChunkData 发送 fed_chunk_data
 * @returns {Promise<void>}
 */
export async function handleFedChunkGetIngress(username, data, peerId, sendChunkData) {
	await handleIncomingChunkGet(username, data, sendChunkData, peerId)
}

/**
 * @param {object} data 入站 fed_chunk_data（含 requestId 时 resolve pending fetch）
 * @returns {void}
 */
export function handleFedChunkDataIngress(data) {
	resolvePendingChunkFetch(data)
}

/**
 * node scope user-room wire：注册 fed_chunk_get / fed_chunk_data。
 * @param {string} username replica 用户名
 * @param {{ on: (name: string, handler: (payload: unknown, peerId: string) => void) => void, send: (name: string, payload: unknown, peerId: string | null) => void }} wire action 表
 * @returns {void}
 */
export function attachNodeScopeFedChunkResponder(username, wire) {
	wire.on('fed_chunk_get', (data, peerId) => {
		void handleFedChunkGetIngress(username, data, peerId, (resp, pid) => {
			try { wire.send('fed_chunk_data', resp, pid) }
			catch { /* disconnected */ }
		})
	})
	wire.on('fed_chunk_data', handleFedChunkDataIngress)
}

/**
 * Trystero room：注册带 requestId 的 fed_chunk_get / fed_chunk_data（TrustGraph 全局 miss）。
 * @param {string} username 用户
 * @param {object} room Trystero room
 * @param {{ enqueue: (prio: number, fn: () => void) => void }} [fedOut] 出站队列
 * @param {(roomKey: string, action: string, rtcLimits: object) => boolean} [guardGet] RTC 负载守卫
 * @param {object} [rtcLimits] RTC 限额
 * @param {string} [roomKey] 房间键
 * @returns {void}
 */
export function attachTrustGraphFedChunkResponder(username, room, fedOut, guardGet, rtcLimits = {}, roomKey = '') {
	const [sendChunkData, getChunkData] = room.makeAction('fed_chunk_data')
	const [, getChunkGet] = room.makeAction('fed_chunk_get')

	getChunkGet((data, peerId) => {
		if (guardGet && !guardGet(roomKey, 'fed_chunk_get', rtcLimits)) return
		void (async () => {
			if (!data || typeof data !== 'object') return
			if (!String(data.requestId || '')) return
			await handleFedChunkGetIngress(username, data, peerId, (resp, pid) => {
				const send = () => {
					try { sendChunkData(resp, pid) }
					catch (error) {
						console.warn('federation: trust-graph chunk response failed', error)
					}
				}
				if (fedOut) fedOut.enqueue(6, send)
				else send()
			})
		})().catch(error => console.warn('federation: trust-graph chunk handler failed', error))
	})

	getChunkData(data => {
		if (!data || typeof data !== 'object' || !data.requestId) return
		handleFedChunkDataIngress(data)
	})
}
