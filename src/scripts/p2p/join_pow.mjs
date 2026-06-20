/**
 * 无状态入群 PoW：绑定群近期 DAG tip/checkpoint root，任意 replica 可独立验证。
 */
import { createHash } from 'node:crypto'

/** 默认 epoch 窗口（1 小时） */
export const JOIN_POW_DEFAULT_EPOCH_MS = 3_600_000

/** 默认 epoch 偏移容忍（±1 个 epoch） */
export const JOIN_POW_DEFAULT_EPOCH_SKEW = 1

/**
 * @param {object} fields  preimage 字段
 * @param {string} fields.groupId 群 ID
 * @param {string} fields.anchorRef 近期 tip 或 checkpoint root
 * @param {string} fields.joinerNodeHash 入群者 nodeHash
 * @param {number|string} fields.epoch epoch 桶
 * @param {string|number} fields.nonce 随机 nonce
 * @returns {string} SHA-256 hex
 */
export function computeJoinPowHash({ groupId, anchorRef, joinerNodeHash, epoch, nonce }) {
	const preimage = `${String(groupId)}:${String(anchorRef)}:${String(joinerNodeHash)}:${String(epoch)}:${String(nonce)}`
	return createHash('sha256').update(preimage, 'utf8').digest('hex')
}

/**
 * @param {string} hexHash SHA-256 hex
 * @param {number} difficultyBits 前导零 bit 数
 * @returns {boolean} 是否满足难度
 */
export function joinPowHashMeetsDifficulty(hexHash, difficultyBits) {
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
 * @param {object} powSolution 客户端 solution
 * @param {object} opts 校验上下文
 * @param {string} opts.groupId 群 ID
 * @param {string} opts.senderNodeHash 签名者 nodeHash（须与 joiner 绑定）
 * @param {string[]} opts.knownAnchors 近期 tip / checkpoint root 列表
 * @param {number} [opts.now=Date.now()] 当前时间
 * @param {number} [opts.difficultyBits=0] 难度（前导零 bit）
 * @param {number} [opts.epochMs=JOIN_POW_DEFAULT_EPOCH_MS] epoch 长度
 * @param {number} [opts.epochSkew=JOIN_POW_DEFAULT_EPOCH_SKEW] 允许 epoch 偏移
 * @returns {boolean} 是否通过
 */
export function verifyJoinPow(powSolution, opts) {
	const difficultyBits = Math.max(0, Math.floor(Number(opts.difficultyBits) || 0))
	if (difficultyBits <= 0) return true
	if (!powSolution || typeof powSolution !== 'object') return false

	const anchorRef = String(powSolution.anchorRef ?? '').trim()
	const nonce = powSolution.nonce
	const epoch = Number(powSolution.epoch)
	const joinerNodeHash = String(powSolution.joinerNodeHash ?? opts.senderNodeHash ?? '').trim().toLowerCase()
	const senderNodeHash = String(opts.senderNodeHash ?? '').trim().toLowerCase()

	if (!anchorRef || nonce == null || !Number.isFinite(epoch)) return false
	if (!joinerNodeHash || joinerNodeHash !== senderNodeHash) return false

	const anchors = (opts.knownAnchors ?? []).map(a => String(a).trim()).filter(Boolean)
	if (!anchors.length || !anchors.includes(anchorRef)) return false

	const epochMs = Math.max(60_000, Number(opts.epochMs) || JOIN_POW_DEFAULT_EPOCH_MS)
	const skew = Math.max(0, Math.floor(Number(opts.epochSkew) ?? JOIN_POW_DEFAULT_EPOCH_SKEW))
	const nowEpoch = Math.floor((opts.now ?? Date.now()) / epochMs)
	if (Math.abs(epoch - nowEpoch) > skew) return false

	const hash = computeJoinPowHash({
		groupId: opts.groupId,
		anchorRef,
		joinerNodeHash,
		epoch,
		nonce: String(nonce),
	})
	return joinPowHashMeetsDifficulty(hash, difficultyBits)
}

/**
 * 浏览器/Node 通用求解（同步 brute-force，适合低难度）。
 * @param {object} fields preimage 字段（不含 nonce）
 * @param {number} difficultyBits 前导零 bit
 * @param {number} [maxAttempts=5_000_000] 最大尝试次数
 * @returns {{ anchorRef: string, joinerNodeHash: string, epoch: number, nonce: string } | null} solution
 */
export function solveJoinPow(fields, difficultyBits, maxAttempts = 5_000_000) {
	const bits = Math.max(1, Math.floor(Number(difficultyBits) || 1))
	for (let nonce = 0; nonce < maxAttempts; nonce++) {
		const hash = computeJoinPowHash({ ...fields, nonce: String(nonce) })
		if (joinPowHashMeetsDifficulty(hash, bits))
			return { ...fields, nonce: String(nonce) }
	}
	return null
}

/**
 * @param {number} difficultyBits 难度 bit
 * @returns {number} 期望哈希次数（2^bits）
 */
export function expectedJoinPowHashes(difficultyBits) {
	const bits = Math.max(0, Math.floor(Number(difficultyBits) || 0))
	return bits <= 52 ? 2 ** bits : Number.MAX_SAFE_INTEGER
}
