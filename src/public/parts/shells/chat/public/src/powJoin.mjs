/**
 * 【文件】public/src/powJoin.mjs
 * 【职责】入群 Proof-of-Work：拉质询、浏览器侧求解、join 时附带 proof。
 * 【原理】fetchPowChallenge → solvePow(哈希 leading zeros) → resolvePowForJoin 合并进 joinGroup body。
 * 【数据结构】{ challenge, difficulty }、proof 字符串。
 * 【关联】groupClient.mjs、deepLinkConsume.mjs；后端入群策略。
 */
import { groupFetch, groupPath } from './api/groupClient.mjs'

/**
 * 拉取入群 PoW 质询。
 * @param {string} groupId 群 ID
 * @returns {Promise<{ challenge: string, difficulty: number }>} 质询串与难度
 */
export async function fetchPowChallenge(groupId) {
	const data = await groupFetch(groupPath(groupId, 'pow-challenge'), { method: 'GET' })
	const row = data.challenge
	return {
		challenge: String(row.challenge),
		difficulty: Math.max(1, Number(row.difficulty) || 4),
	}
}

/**
 * 浏览器端 SHA-256 PoW：`sha256(\`${groupId}:${challenge}:${nonce}\`)` 前 difficulty 位为 0。
 * @param {string} groupId 群 ID
 * @param {string} challenge 服务端质询
 * @param {number} difficulty 前导零 hex 位数
 * @returns {Promise<{ challenge: string, nonce: string }>} 可写入 join 请求体的 solution
 */
export async function solvePow(groupId, challenge, difficulty) {
	const prefix = '0'.repeat(Math.max(1, Math.min(64, Math.floor(difficulty))))
	let nonce = 0
	while (true) {
		const nonceStr = String(nonce)
		const input = `${groupId}:${challenge}:${nonceStr}`
		const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
		const hex = [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, '0')).join('')
		if (hex.startsWith(prefix))
			return { challenge, nonce: nonceStr }
		nonce++
		if (nonce % 5000 === 0)
			await new Promise(resolve => setTimeout(resolve, 0))
	}
}

/**
 * 若群 joinPolicy 为 pow，则挖矿并返回 solution；否则 `null`。
 * @param {string} groupId 群 ID
 * @param {object | null} [state] 已有群 state（含 groupSettings）
 * @returns {Promise<{ challenge: string, nonce: string } | null>} PoW solution 或无需 PoW 时为 null
 */
export async function resolvePowForJoin(groupId, state = null) {
	const policy = state?.groupSettings?.joinPolicy
	if (policy !== 'pow') return null
	const { challenge, difficulty } = await fetchPowChallenge(groupId)
	return solvePow(groupId, challenge, difficulty)
}
