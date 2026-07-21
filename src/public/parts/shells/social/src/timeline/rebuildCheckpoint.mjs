import { Buffer } from 'node:buffer'

import { signCheckpoint } from 'npm:@steve02081504/fount-p2p/crypto/checkpoint_sign'
import { writeJsonAtomicSynced } from 'npm:@steve02081504/fount-p2p/dag/storage'

import { getEntitySecretKey } from '../../../chat/src/entity/identity.mjs'
import { timelineSnapshotPath } from '../paths.mjs'

/**
 * 将物化视图写成带 owner 签名的 snapshot.json。
 * @param {string} username replica
 * @param {string} entityHash 时间线 owner
 * @param {object} view 物化视图（含 checkpoint_event_id）
 * @returns {Promise<object>} 落盘快照
 */
export async function rebuildSignedTimelineSnapshot(username, entityHash, view) {
	let secretHex = ''
	try {
		secretHex = await getEntitySecretKey(username, entityHash)
	}
	catch {
		/* 远端/未托管实体无本地密钥，落未签名快照 */
	}
	if (!secretHex || secretHex.length !== 64) {
		await writeJsonAtomicSynced(timelineSnapshotPath(username, entityHash), view)
		return view
	}
	const secretKey = new Uint8Array(Buffer.from(secretHex, 'hex'))
	const signed = await signCheckpoint(view, secretKey)
	await writeJsonAtomicSynced(timelineSnapshotPath(username, entityHash), signed)
	return signed
}
