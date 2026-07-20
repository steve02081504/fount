/**
 * 跨观察者归档 digest 声明：联邦 gossip 对质等价欺骗。
 */
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { penalizeArchiveServeMismatch } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { mutateArchiveManifest } from '../archive/index.mjs'

/**
 * @param {object} manifest archive manifest（可变）
 * @param {string} channelId 频道
 * @param {string} utcMonth `YYYY-MM`
 * @param {string} peerNodeHash 声明方
 * @param {string} digest 64 hex digest
 * @returns {boolean} 是否与已有观测冲突
 */
export function mergeDigestObservation(manifest, channelId, utcMonth, peerNodeHash, digest) {
	const peer = String(peerNodeHash || '').trim()
	const dig = String(digest || '').trim().toLowerCase()
	if (!isHex64(peer) || !isHex64(dig)) return false
	if (!manifest.peerDigestObservations) manifest.peerDigestObservations = {}
	const key = `${channelId}:${utcMonth}:${peer}`
	const prev = manifest.peerDigestObservations[key]
	const conflict = Boolean(prev && prev !== dig)
	manifest.peerDigestObservations[key] = dig
	return conflict
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {{ channelId: string, utcMonth: string, peerNodeHash: string, digest: string }} claim 远端声明
 * @returns {Promise<boolean>} 是否检测到冲突并已惩罚
 */
export async function applyRemoteDigestClaim(username, groupId, claim) {
	const channelId = String(claim.channelId || '').trim()
	const utcMonth = String(claim.utcMonth || '').trim()
	const peer = String(claim.peerNodeHash || '').trim()
	const digest = String(claim.digest || '').trim().toLowerCase()
	if (!channelId || !utcMonth || !isHex64(peer) || !isHex64(digest)) return false

	let conflict = false
	await mutateArchiveManifest(username, groupId, manifest => {
		conflict = mergeDigestObservation(manifest, channelId, utcMonth, peer, digest)
	})
	if (conflict)
		penalizeArchiveServeMismatch(peer)
	return conflict
}

/**
 * @param {object} slot 联邦槽
 * @param {string} groupId 群 ID
 * @param {Array<{ channelId: string, utcMonth: string, peerNodeHash: string, digest: string }>} observations 本地观测
 * @returns {void}
 */
export function fanoutDigestClaims(slot, groupId, observations) {
	if (!slot?.send || !observations?.length) return
	for (const row of observations) {
		if (!row.channelId || !row.utcMonth || !isHex64(row.peerNodeHash) || !isHex64(row.digest)) continue
		try {
			slot.send('fed_archive_digest_obs', {
				groupId,
				channelId: row.channelId,
				utcMonth: row.utcMonth,
				peerNodeHash: row.peerNodeHash,
				digest: row.digest,
			}, null)
		}
		catch { /* ignore send failure */ }
	}
}
