/**
 * 【文件】public/src/powJoin.mjs
 * 【职责】入群 Proof-of-Work：无状态自验证，绑定群近期 DAG tip/checkpoint root。
 */
import {
	countAchievedLeadingZeroBits,
	JOIN_POW_DEFAULT_EPOCH_MS,
} from '../../../../../scripts/p2p/join_pow.mjs'
import { collectJoinPowAnchors } from '../../src/chat/governance/joinPowAnchors.mjs'

/**
 * @param {string} hexHash SHA-256 hex
 * @param {number} floorBits 准入 floor
 * @returns {boolean}
 */
function hashMeetsFloor(hexHash, floorBits) {
	const bits = Math.max(0, Math.min(256, Math.floor(Number(floorBits) || 0)))
	if (bits <= 0) return true
	return countAchievedLeadingZeroBits(hexHash) >= bits
}

/**
 * @param {object} fields preimage 字段
 * @param {number} floorBits 准入 floor
 * @param {number} [targetBits] 自愿目标 bit（省略则等于 floor）
 * @returns {Promise<{ anchorRef: string, joinerNodeHash: string, epoch: number, nonce: string, achievedBits: number } | null>}
 */
export async function solveJoinPow(fields, floorBits, targetBits) {
	const floor = Math.max(1, Math.floor(Number(floorBits) || 1))
	const target = Math.max(floor, Math.floor(Number(targetBits) || floor))
	const epochMs = Number(fields.epochMs) || JOIN_POW_DEFAULT_EPOCH_MS
	const epoch = Number.isFinite(fields.epoch) ? fields.epoch : Math.floor(Date.now() / epochMs)
	let best = null
	for (let nonce = 0; nonce < 5_000_000; nonce++) {
		const nonceStr = String(nonce)
		const preimage = `${fields.groupId}:${fields.anchorRef}:${fields.joinerNodeHash}:${epoch}:${nonceStr}`
		const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(preimage))
		const hex = [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, '0')).join('')
		const achieved = countAchievedLeadingZeroBits(hex)
		if (hashMeetsFloor(hex, floor)) {
			const solution = { anchorRef: fields.anchorRef, joinerNodeHash: fields.joinerNodeHash, epoch, nonce: nonceStr, achievedBits: achieved }
			if (achieved >= target) return solution
			if (!best || achieved > best.achievedBits) best = solution
		}
		if (nonce % 5000 === 0)
			await new Promise(resolve => setTimeout(resolve, 0))
	}
	return best
}

/**
 * @param {string} groupId 群 ID
 * @param {object | null} [state] 已有群 state
 * @param {string} joinerNodeHash 入群者 nodeHash
 * @param {{ powAnchorRef?: string, powAnchors?: string[], targetBits?: number }} [bootstrap] bootstrap
 * @returns {Promise<{ anchorRef: string, joinerNodeHash: string, epoch: number, nonce: string, achievedBits: number } | null>}
 */
export async function resolvePowForJoin(groupId, state = null, joinerNodeHash = '', bootstrap = null) {
	const policy = state?.groupSettings?.joinPolicy
	if (policy !== 'pow') return null
	const floorBits = Number(state?.groupSettings?.powFloorBits)
		|| Number(state?.groupSettings?.powDifficulty)
		|| Number(state?.groupSettings?.powDifficultyBits)
		|| 18
	const targetBits = bootstrap?.targetBits ?? floorBits
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
	}, floorBits, targetBits)
}
