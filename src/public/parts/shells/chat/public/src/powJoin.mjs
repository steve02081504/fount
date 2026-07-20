/**
 * 【文件】public/src/powJoin.mjs
 * 【职责】入群 Proof-of-Work：无状态自验证，绑定群近期 DAG tip/checkpoint root。
 * 【原理】浏览器端实现；纯函数/常量与后端 `npm:@steve02081504/fount-p2p/governance/join_pow` 对齐
 *   （后端依赖 node:crypto，不可直接 import 到浏览器）。anchor 提取复用 shared/joinPowAnchors。
 */
import { bytesToHex } from '../shared/digest.mjs'
import { collectJoinPowAnchors } from '../shared/joinPowAnchors.mjs'

/** 默认 epoch 窗口（1 小时），与 `npm:@steve02081504/fount-p2p/governance/join_pow` 一致。 */
const JOIN_POW_DEFAULT_EPOCH_MS = 3_600_000

/**
 * 计算 SHA-256 hex 的实际前导零 bit 数，与 `npm:@steve02081504/fount-p2p/governance/join_pow` 的 `countAchievedLeadingZeroBits` 一致。
 * @param {string} hexHash SHA-256 hex
 * @returns {number} 实际达成的前导零 bit 数 0..256
 */
function countAchievedLeadingZeroBits(hexHash) {
	let bits = 0
	for (let i = 0; i < hexHash.length; i++) {
		const nibble = Number.parseInt(hexHash[i], 16)
		if (!Number.isFinite(nibble)) break
		if (nibble === 0) {
			bits += 4
			continue
		}
		for (let b = 3; b >= 0; b--)
			if ((nibble & (1 << b)) === 0) bits++
			else return bits

	}
	return bits
}

/**
 * @param {string} hexHash SHA-256 hex
 * @param {number} floorBits 准入 floor
 * @returns {boolean} 是否达到 floor 难度
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
 * @returns {Promise<{ anchorRef: string, joinerNodeHash: string, epoch: number, nonce: string, achievedBits: number } | null>} PoW 解（无解为 null）
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
		const hex = bytesToHex(new Uint8Array(hashBuffer))
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
 * @returns {Promise<{ anchorRef: string, joinerNodeHash: string, epoch: number, nonce: string, achievedBits: number } | null>} PoW 解；非 pow 策略或缺 anchor 为 null
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
		: state ? collectJoinPowAnchors(state) : []
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
