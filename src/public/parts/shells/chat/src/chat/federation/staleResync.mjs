/**
 * tipsHash 错位时优先 joinSnapshot，避免先全量 replay events.jsonl。
 */
import { readFile } from 'node:fs/promises'

import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { snapshotPath } from '../lib/paths.mjs'

import { requestJoinSnapshotFromPeers } from './joinSnapshot.mjs'

/**
 * @param {string} localTipsHash 本机 checkpoint.local_tips_hash
 * @param {object[]} remoteSummaries 对端 tip pong 携带的 archiveSummary
 * @returns {boolean} 是否应优先 snapshot
 */
export function shouldPreferJoinSnapshot(localTipsHash, remoteSummaries) {
	const local = String(localTipsHash || '').trim().toLowerCase()
	if (!isHex64(local)) return true
	return remoteSummaries.some(summary => {
		const remote = String(summary?.tipsHash || '').trim().toLowerCase()
		return isHex64(remote) && remote !== local
	})
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object | null} slot 联邦槽
 * @param {{ remoteSummaries?: object[] }} [opts] 远端摘要
 * @returns {Promise<{ snapshotted: boolean }>} 是否已应用 joinSnapshot
 */
export async function maybeJoinSnapshotOnStaleTips(username, groupId, slot, opts = {}) {
	if (!slot) return { snapshotted: false }
	let checkpoint = null
	try {
		checkpoint = JSON.parse(await readFile(snapshotPath(username, groupId), 'utf8'))
	}
	catch { /* absent */ }
	const localTipsHash = checkpoint?.local_tips_hash || ''
	if (!checkpoint?.checkpoint_event_id
		|| shouldPreferJoinSnapshot(localTipsHash, opts.remoteSummaries || []))
		return { snapshotted: (await requestJoinSnapshotFromPeers(username, groupId, slot)).applied }
	return { snapshotted: false }
}
