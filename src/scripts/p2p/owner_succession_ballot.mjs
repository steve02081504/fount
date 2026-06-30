/**
 * 群主继任联署选票验签（§8）：管理员对固定 canonical 载荷签名，达到阈值即通过。
 */
import { Buffer } from 'node:buffer'

import { canonicalStringify } from './canonical_json.mjs'
import { pubKeyHash, verify } from './crypto.mjs'
import { isHex64, isSignatureHex128 } from './hexIds.mjs'

const BALLOT_DOMAIN = 'fount-owner-succession'

/**
 * @param {{ proposedOwnerPubKeyHash: string, groupId: string, ballotId: string }} ballot 选票正文
 * @returns {Buffer} 验签消息
 */
export function ownerSuccessionBallotSignBytes(ballot) {
	const body = {
		proposedOwnerPubKeyHash: String(ballot.proposedOwnerPubKeyHash ?? '').trim().toLowerCase(),
		groupId: String(ballot.groupId ?? '').trim(),
		ballotId: String(ballot.ballotId ?? '').trim(),
	}
	return Buffer.from(`${BALLOT_DOMAIN}\0${canonicalStringify(body)}`, 'utf8')
}

/**
 * 校验管理员联署是否达到 `thresholdRatio`（默认半数以上）。
 * @param {{ proposedOwnerPubKeyHash: string, groupId: string, ballotId: string, adminSignatures: Array<{ pubKeyHex: string, signature: string }> }} ballot 选票正文与签名列表
 * @param {Set<string>} adminPubKeyHashes 合法管理员公钥指纹
 * @param {number} [thresholdRatio] 通过比例 (0,1]
 * @returns {Promise<boolean>} 达到阈值时为 true
 */
export async function verifyOwnerSuccessionThreshold(ballot, adminPubKeyHashes, thresholdRatio = 0.5) {
	const admins = adminPubKeyHashes instanceof Set ? adminPubKeyHashes : new Set(adminPubKeyHashes)
	if (!admins.size) return false

	const ratio = Number(thresholdRatio)
	if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) return false

	const signBytes = ownerSuccessionBallotSignBytes(ballot)
	const needed = Math.ceil(admins.size * ratio)
	const seen = new Set()
	let valid = 0

	for (const entry of ballot.adminSignatures || []) {
		const pubKeyHex = String(entry?.pubKeyHex ?? '').trim().toLowerCase()
		const signatureHex = String(entry?.signature ?? '').trim().toLowerCase()
		if (!isHex64(pubKeyHex) || !isSignatureHex128(signatureHex)) continue

		const hash = pubKeyHash(Buffer.from(pubKeyHex, 'hex'))
		if (!admins.has(hash) || seen.has(hash)) continue
		if (!await verify(Buffer.from(signatureHex, 'hex'), signBytes, Buffer.from(pubKeyHex, 'hex'))) continue

		seen.add(hash)
		if (++valid >= needed) return true
	}
	return false
}
