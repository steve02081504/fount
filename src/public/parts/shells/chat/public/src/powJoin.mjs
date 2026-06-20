/**
 * 【文件】public/src/powJoin.mjs
 * 【职责】入群 Proof-of-Work：无状态自验证，绑定群近期 DAG tip/checkpoint root。
 * 【原理】resolvePowForJoin 读取 state 或 bootstrap 中的 anchorRef，浏览器侧 brute-force nonce。
 * 【数据结构】{ anchorRef, epoch, nonce, joinerNodeHash }。
 * 【关联】groupClient.mjs、deepLinkConsume.mjs；scripts/p2p/join_pow.mjs 同算法。
 */
import { JOIN_POW_DEFAULT_EPOCH_MS } from '../../../../../scripts/p2p/join_pow.mjs'
import { collectJoinPowAnchors } from '../../src/chat/governance/joinPowAnchors.mjs'

/**
 * @param {string} hexHash SHA-256 hex
 * @param {number} difficultyBits 前导零 bit
 * @returns {boolean}
 */
function hashMeetsDifficulty(hexHash, difficultyBits) {
	const bits = Math.max(0, Math.min(256, Math.floor(Number(difficultyBits) || 0)))
	if (bits <= 0) return true
	const neededHexChars = Math.ceil(bits / 4)
	const prefix = hexHash.slice(0, neededHexChars)
	if (prefix.length < neededHexChars) return false
	for (let i = 0; i < prefix.length; i++) {
		const nibble = Number.parseInt(prefix[i], 16)
		if (!Number.isFinite(nibble)) return false
		const nibbleBits = i < neededHexChars - 1 ? 4 : bits - i * 4
		const mask = (0xF << (4 - nibbleBits)) & 0xF
		if ((nibble & mask) !== 0) return false
	}
	return true
}

/**
 * @param {object} fields preimage 字段
 * @param {number} difficultyBits 难度
 * @returns {Promise<{ anchorRef: string, joinerNodeHash: string, epoch: number, nonce: string } | null>}
 */
export async function solveJoinPow(fields, difficultyBits) {
	const bits = Math.max(1, Math.floor(Number(difficultyBits) || 1))
	const epochMs = Number(fields.epochMs) || JOIN_POW_DEFAULT_EPOCH_MS
	const epoch = Number.isFinite(fields.epoch) ? fields.epoch : Math.floor(Date.now() / epochMs)
	for (let nonce = 0; nonce < 5_000_000; nonce++) {
		const nonceStr = String(nonce)
		const preimage = `${fields.groupId}:${fields.anchorRef}:${fields.joinerNodeHash}:${epoch}:${nonceStr}`
		const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(preimage))
		const hex = [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, '0')).join('')
		if (hashMeetsDifficulty(hex, bits))
			return { anchorRef: fields.anchorRef, joinerNodeHash: fields.joinerNodeHash, epoch, nonce: nonceStr }
		if (nonce % 5000 === 0)
			await new Promise(resolve => setTimeout(resolve, 0))
	}
	return null
}

/**
 * 若群 joinPolicy 为 pow，则挖矿并返回 solution；否则 `null`。
 * @param {string} groupId 群 ID
 * @param {object | null} [state] 已有群 state（含 groupSettings、dagTips）
 * @param {string} joinerNodeHash 入群者 nodeHash
 * @param {{ powAnchorRef?: string, powAnchors?: string[] }} [bootstrap] 邀请/bootstrap 携带的 anchor 提示
 * @returns {Promise<{ anchorRef: string, joinerNodeHash: string, epoch: number, nonce: string } | null>}
 */
export async function resolvePowForJoin(groupId, state = null, joinerNodeHash = '', bootstrap = null) {
	const policy = state?.groupSettings?.joinPolicy
	if (policy !== 'pow') return null
	const difficultyBits = Number(state?.groupSettings?.powDifficulty)
		|| Number(state?.groupSettings?.powDifficultyBits)
		|| 18
	const anchors = bootstrap?.powAnchors?.length
		? bootstrap.powAnchors
		: (state ? collectJoinPowAnchors(state) : [])
	const anchorRef = bootstrap?.powAnchorRef || anchors[0]
	if (!anchorRef || !joinerNodeHash) return null
	const epochMs = Number(state?.groupSettings?.powEpochMs) || JOIN_POW_DEFAULT_EPOCH_MS
	return solveJoinPow({
		groupId,
		anchorRef,
		joinerNodeHash,
		epochMs,
	}, difficultyBits)
}
