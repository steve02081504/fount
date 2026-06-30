/**
 * 【文件】files/chunkReplicationAck.mjs
 * 【职责】§10.2 上传后 P2P 密文块复制 ACK 跟踪：等待 M_eff 个不同 Trystero 邻居 fed_chunk_ack 或超时。
 * 【原理】pendingWaits 内存表；beginChunkReplicationWait 注册 timer；recordChunkReplicationAck 按 peer/node 去重后 resolve。与 replicateChunkToFederation 配合满足冗余策略。
 * 【数据结构】Map 键 username\0groupId\0ciphertextHash；值含 requiredAcks、ackPeers、timer、expectedPeerKeys。
 * 【关联】federation/chunks.mjs、groupFiles putEncryptedChunk、scripts/p2p/reputation.mjs。
 */

/** @type {Map<string, {
 *   requiredAcks: number,
 *   ackPeers: Set<string>,
 *   expectedPeerKeys: Set<string>,
 *   timer: ReturnType<typeof setTimeout>,
 *   resolve: Function,
 * }>} */
const pendingWaits = new Map()

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} ciphertextHash 密文哈希 hex
 * @returns {string} 等待表键
 */
export function chunkReplicationWaitKey(username, groupId, ciphertextHash) {
	return `${String(username).trim()}\0${String(groupId).trim()}\0${String(ciphertextHash).trim().toLowerCase()}`
}

/**
 * @param {Set<string>} ackPeers 已 ACK 的 peer 键
 * @param {Set<string>} expectedPeerKeys 复制目标 nodeHash / peerId
 * @returns {string[]} 未 ACK 的目标
 */
function missingReplicationPeers(ackPeers, expectedPeerKeys) {
	if (!expectedPeerKeys.size) return []
	return [...expectedPeerKeys].filter(key => !ackPeers.has(key))
}

/**
 * 上传方向邻居广播后，等待至多 `requiredAcks` 个不同节点 ACK。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} ciphertextHash 密文哈希
 * @param {number} requiredAcks 目标 ACK 数（0 则立即 resolve）
 * @param {number} [timeoutMs=5000] 超时毫秒
 * @param {string[]} [expectedPeerKeys] 已向其发送 fed_chunk_put 的 nodeHash / peerId
 * @returns {Promise<{ acked: number, required: number, timedOut: boolean, unavailable?: boolean, missingPeerKeys?: string[] }>} ACK 统计
 */
export function beginChunkReplicationWait(username, groupId, ciphertextHash, requiredAcks, timeoutMs = 5000, expectedPeerKeys = []) {
	const required = Math.max(0, Math.floor(Number(requiredAcks) || 0))
	if (required <= 0)
		return Promise.resolve({ acked: 0, required: 0, timedOut: false })

	const key = chunkReplicationWaitKey(username, groupId, ciphertextHash)
	const existing = pendingWaits.get(key)
	if (existing) clearTimeout(existing.timer)

	const expected = new Set(
		(Array.isArray(expectedPeerKeys) ? expectedPeerKeys : [])
			.map(id => String(id || '').trim())
			.filter(Boolean),
	)

	return new Promise((resolve) => {
		const ackPeers = new Set()
		const timer = setTimeout(() => {
			pendingWaits.delete(key)
			resolve({
				acked: ackPeers.size,
				required,
				timedOut: true,
				missingPeerKeys: missingReplicationPeers(ackPeers, expected),
			})
		}, Math.max(500, timeoutMs))

		pendingWaits.set(key, {
			requiredAcks: required,
			ackPeers,
			expectedPeerKeys: expected,
			timer,
			/**
			 * @param {{ acked: number, required: number, timedOut: boolean, unavailable?: boolean, missingPeerKeys?: string[] }} result 结果
			 */
			resolve: (result) => {
				clearTimeout(timer)
				pendingWaits.delete(key)
				resolve(result)
			},
		})
	})
}

/**
 * 入站 `fed_chunk_ack`：记录邻居已持久化该块。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} ciphertextHash 密文哈希
 * @param {string} peerKey 邻居 nodeId 或 peerId
 * @returns {void}
 */
export function recordChunkReplicationAck(username, groupId, ciphertextHash, peerKey) {
	const key = chunkReplicationWaitKey(username, groupId, ciphertextHash)
	const pending = pendingWaits.get(key)
	if (!pending) return
	const pk = String(peerKey || '').trim()
	if (!pk) return
	pending.ackPeers.add(pk)
	if (pending.ackPeers.size >= pending.requiredAcks)
		pending.resolve({
			acked: pending.ackPeers.size,
			required: pending.requiredAcks,
			timedOut: false,
			missingPeerKeys: missingReplicationPeers(pending.ackPeers, pending.expectedPeerKeys),
		})
}

/**
 * 复制发出后登记期待 ACK 的对端（须在 beginChunkReplicationWait 之后、超时前调用）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} ciphertextHash 密文哈希
 * @param {string[]} peerKeys nodeHash 或 peerId
 * @returns {void}
 */
export function registerChunkReplicationTargets(username, groupId, ciphertextHash, peerKeys) {
	const key = chunkReplicationWaitKey(username, groupId, ciphertextHash)
	const pending = pendingWaits.get(key)
	if (!pending) return
	for (const peerKey of peerKeys) {
		const id = String(peerKey || '').trim()
		if (id) pending.expectedPeerKeys.add(id)
	}
}
