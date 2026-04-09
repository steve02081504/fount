import { verify, pubKeyHash } from './crypto.mjs'
import { signPayloadBytes } from './dag.mjs'
import { canonicalStringify } from './canonical_json.mjs'

/**
 * home_transfer 阈值联署：content.adminSignatures: { pubKeyHex, signature }[]
 * 验签负载为 canonicalStringify({ proposedHomeNodeId, groupId, ballotId })
 * @param {object} p
 * @param {string} p.proposedHomeNodeId
 * @param {string} p.groupId
 * @param {string} p.ballotId
 * @param {Array<{ pubKeyHex: string, signature: string }>} p.adminSignatures hex
 * @param {Set<string>|string[]} registeredAdminKeyHashes
 * @param {number} thresholdRatio 如 0.5 表示 >50%
 */
export async function verifyHomeTransferThreshold(p, registeredAdminKeyHashes, thresholdRatio = 0.5) {
	const admins = new Set([...registeredAdminKeyHashes].map(String))
	const payload = signPayloadBytes({
		proposedHomeNodeId: p.proposedHomeNodeId,
		groupId: p.groupId,
		ballotId: p.ballotId,
	})
	let ok = 0
	const seen = new Set()
	for (const { pubKeyHex, signature } of p.adminSignatures || []) {
		const pk = hexToU8(pubKeyHex)
		const sig = hexToU8(signature)
		// eslint-disable-next-line no-await-in-loop
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

function hexToU8(hex) {
	const s = String(hex).replace(/^0x/, '')
	const out = new Uint8Array(s.length / 2)
	for (let i = 0; i < out.length; i++)
		out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
	return out
}

export function homeTransferSignPayload(proposedHomeNodeId, groupId, ballotId) {
	return canonicalStringify({ proposedHomeNodeId, groupId, ballotId })
}

/**
 * 群主/代理执行官 succession：content.adminSignatures 联署 proposedOwnerPubKeyHash
 * @param {object} p
 * @param {string} p.proposedOwnerPubKeyHash
 * @param {string} p.groupId
 * @param {string} p.ballotId
 * @param {Array<{ pubKeyHex: string, signature: string }>} p.adminSignatures
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
		// eslint-disable-next-line no-await-in-loop
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
