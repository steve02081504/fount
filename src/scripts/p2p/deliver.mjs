import { getNodeHash } from './node_context.mjs'
import { ensureUserRoom } from './user_room.mjs'

/**
 * @param {string} username replica（trust graph 上下文）
 * @param {string} toNodeHash 64 hex 目标节点
 * @param {string} actionName Trystero action
 * @param {unknown} payload 载荷
 * @returns {Promise<boolean>} 是否成功发送到目标节点
 */
export async function deliver(username, toNodeHash, actionName, payload) {
	const target = toNodeHash.trim().toLowerCase()
	if (!target) return false
	const { sendToNode } = await import('./trust_graph.mjs')
	return sendToNode(username, target, actionName, payload)
}

/**
 * @param {string} username replica
 * @param {string} actionName Trystero action
 * @param {unknown} payload 载荷
 * @param {string | null} [exceptPeerId] 跳过的 peer
 * @param {number} [limit=6] 最多转发 peer 数
 * @returns {Promise<number>} 实际转发的 peer 数
 */
export async function deliverToUserRoomPeers(username, actionName, payload, exceptPeerId = null, limit = 6) {
	const slot = await ensureUserRoom({ replicaUsername: username })
	if (!slot) return 0
	const body = { ...payload, nodeHash: getNodeHash() }
	let sent = 0
	const peers = [...slot.getRoster()
		.filter(({ peerId }) => peerId && peerId !== exceptPeerId)]
	for (let swapIndex = peers.length - 1; swapIndex > 0; swapIndex--) {
		const pickIndex = Math.floor(Math.random() * (swapIndex + 1))
		const tmp = peers[swapIndex]
		peers[swapIndex] = peers[pickIndex]
		peers[pickIndex] = tmp
	}
	for (const { peerId } of peers)
		try {
			slot.sendToPeer(peerId, actionName, body)
			sent++
			if (sent >= limit) break
		}
		catch { /* disconnected */ }

	return sent
}
