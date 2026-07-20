/**
 * 【文件】public/hub/membersDigest.mjs
 * 【职责】成员列表 Merkle 摘要：为联邦成员同步计算活跃成员键根。
 */
import { bytesToHex, hexToBytes, sha256Hex } from '../shared/digest.mjs'

const MEMBER_KEY_RE = /^[\da-f]{64}$/u

/**
 * @param {unknown} value 成员键
 * @returns {boolean} 是否为合法成员键
 */
function isMemberKey(value) {
	return MEMBER_KEY_RE.test(String(value || '').trim().toLowerCase())
}

/**
 * @param {Uint8Array} left 左子摘要
 * @param {Uint8Array} right 右子摘要
 * @returns {Promise<Uint8Array>} 拼接后再哈希
 */
async function sha256Pair(left, right) {
	const buf = new Uint8Array(left.length + right.length)
	buf.set(left, 0)
	buf.set(right, left.length)
	return hexToBytes(await sha256Hex(buf))
}

/**
 * @param {string[]} ids 成员键（64 hex）
 * @returns {Promise<string>} Merkle 根 hex
 */
export async function computeMembersMerkleRoot(ids) {
	const sorted = [...new Set(ids
		.map(id => String(id || '').trim().toLowerCase())
		.filter(isMemberKey))]
		.sort()
	if (!sorted.length)
		return sha256Hex(new Uint8Array())
	/** @type {Uint8Array[]} */
	let level = await Promise.all(sorted.map(async id => hexToBytes(await sha256Hex(new TextEncoder().encode(id)))))
	while (level.length > 1) {
		/** @type {Uint8Array[]} */
		const next = []
		for (let index = 0; index < level.length; index += 2) {
			const left = level[index]
			const right = index + 1 < level.length ? level[index + 1] : left
			next.push(await sha256Pair(left, right))
		}
		level = next
	}
	return bytesToHex(level[0])
}

/**
 * 从 `/groups/:id/state` 的 `members` 汇总活跃成员键。
 * @param {{ members: object[] }} state 群 state（含完整活跃成员列表）
 * @returns {string[]} 已排序的成员键列表
 */
export function collectActiveMemberHashes(state) {
	return [...new Set((state.members || [])
		.map(member => String(member.memberKey || member.pubKeyHash || '').trim().toLowerCase())
		.filter(isMemberKey))]
		.sort()
}
