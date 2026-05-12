import { verify, pubKeyHash } from './crypto.mjs'
import { signPayloadBytes } from './dag.mjs'

/**
 * 十六进制字符串 → Uint8Array（可带 0x 前缀）
 *
 * @param {string} hex 偶数位十六进制
 * @returns {Uint8Array} 解码后的字节
 */
function hexToU8(hex) {
	const s = String(hex).replace(/^0x/, '')
	const out = new Uint8Array(s.length / 2)
	for (let i = 0; i < out.length; i++)
		out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
	return out
}

/**
 * 群主/代理执行官 succession：content.adminSignatures 联署 proposedOwnerPubKeyHash
 *
 * @param {object} p ballot 内容
 * @param {string} p.proposedOwnerPubKeyHash 提议的新执行官公钥指纹
 * @param {string} p.groupId 群组 id
 * @param {string} p.ballotId 选票 id
 * @param {Array<{ pubKeyHex: string, signature: string }>} p.adminSignatures 管理员联署
 * @param {Set<string>|string[]} registeredAdminKeyHashes 已登记管理员公钥指纹
 * @param {number} [thresholdRatio=0.5] 通过比例阈值
 * @returns {Promise<boolean>} 达到阈值且验签通过则为 true
 */
export async function verifyOwnerSuccessionThreshold(p, registeredAdminKeyHashes, thresholdRatio = 0.5) {
	const admins = new Set([...registeredAdminKeyHashes].map(String))
	const payload = signPayloadBytes({
		proposedOwnerPubKeyHash: p.proposedOwnerPubKeyHash,
		groupId: p.groupId,
		ballotId: p.ballotId,
	})
	let ok = 0
	const seen = new Set()
	for (const { pubKeyHex, signature } of p.adminSignatures || []) {
		const pk = hexToU8(pubKeyHex)
		const sig = hexToU8(signature)
		const v = await verify(sig, payload, pk)
		if (!v) continue
		const h = pubKeyHash(pk)
		if (!admins.has(h)) continue
		if (seen.has(h)) continue
		seen.add(h)
		ok++
	}
	const need = Math.ceil(admins.size * thresholdRatio)
	return ok >= need
}
