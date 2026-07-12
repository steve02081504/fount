import { Buffer } from 'node:buffer'

import { signCheckpoint } from 'npm:@steve02081504/fount-p2p/crypto/checkpoint_sign'
import { writeJsonAtomicSynced } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { getOperatorSecretKey } from '../../../../../../server/p2p_server/operator_identity.mjs'
import { timelineSnapshotPath } from '../paths.mjs'

/**
 * 将物化视图写成带 owner 签名的 snapshot.json。
 * @param {string} username replica
 * @param {string} entityHash 时间线 owner
 * @param {object} view 物化视图（含 checkpoint_event_id）
 * @returns {Promise<object>} 落盘快照
 */
export async function rebuildSignedTimelineSnapshot(username, entityHash, view) {
	const secretHex = await getOperatorSecretKey(username)
	if (!secretHex || secretHex.length !== 64) {
		await writeJsonAtomicSynced(timelineSnapshotPath(username, entityHash), view)
		return view
	}
	const secretKey = new Uint8Array(Buffer.from(secretHex, 'hex'))
	const signed = await signCheckpoint(view, secretKey)
	await writeJsonAtomicSynced(timelineSnapshotPath(username, entityHash), signed)
	return signed
}
