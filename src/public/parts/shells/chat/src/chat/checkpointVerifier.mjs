import { verifyCheckpointSignature } from '../../../../../../scripts/p2p/checkpoint.mjs'
import { merkleRoot } from '../../../../../../scripts/p2p/dag.mjs'

const HASH64 = /^[0-9a-f]{64}$/iu

/**
 * @param {object} checkpoint 远端 checkpoint 对象
 * @param {Uint8Array} ownerPubKey 期望的群主公钥（验签用）
 * @returns {Promise<{ valid: boolean, reason?: string }>} 校验结果与失败原因
 */
export async function verifyRemoteCheckpoint(checkpoint, ownerPubKey) {
	if (!checkpoint || typeof checkpoint !== 'object')
		return { valid: false, reason: 'checkpoint missing or not an object' }

	const ids = checkpoint.eventIdsInEpoch
	if (!Array.isArray(ids) || !ids.length)
		return { valid: false, reason: 'eventIdsInEpoch missing or empty' }
	if (!ids.every(id => typeof id === 'string' && HASH64.test(id)))
		return { valid: false, reason: 'eventIdsInEpoch contains invalid event id' }

	const expectedRoot = merkleRoot(ids)
	if (checkpoint.epoch_root_hash !== expectedRoot)
		return { valid: false, reason: 'epoch_root_hash does not match Merkle root of eventIdsInEpoch' }

	if (checkpoint.owner_signature != null && checkpoint.owner_signature !== '') {
		if (!(ownerPubKey instanceof Uint8Array) || ownerPubKey.length !== 32)
			return { valid: false, reason: 'ownerPubKey required for signed checkpoint' }
		const ok = await verifyCheckpointSignature(checkpoint, ownerPubKey)
		if (!ok) return { valid: false, reason: 'owner_signature verification failed' }
	}

	const curEpoch = checkpoint.epoch_id
	if (typeof curEpoch !== 'number' || !Number.isFinite(curEpoch) || curEpoch <= 0 || curEpoch !== Math.floor(curEpoch))
		return { valid: false, reason: 'epoch_id invalid' }

	const chain = checkpoint.epoch_chain
	if (chain != null) {
		if (!Array.isArray(chain))
			return { valid: false, reason: 'epoch_chain is not an array' }
		let prev = -Infinity
		for (let i = 0; i < chain.length; i++) {
			const e = chain[i]
			if (!e || typeof e !== 'object')
				return { valid: false, reason: 'epoch_chain entry invalid' }
			const eid = e.epoch_id
			const erh = e.epoch_root_hash
			const cid = e.checkpoint_event_id
			if (typeof eid !== 'number' || !Number.isFinite(eid) || eid <= 0 || eid !== Math.floor(eid))
				return { valid: false, reason: 'epoch_chain epoch_id invalid' }
			if (typeof erh !== 'string' || !HASH64.test(erh))
				return { valid: false, reason: 'epoch_chain epoch_root_hash invalid' }
			if (typeof cid !== 'string' || !HASH64.test(cid))
				return { valid: false, reason: 'epoch_chain checkpoint_event_id invalid' }
			if (eid <= prev) return { valid: false, reason: 'epoch_chain epoch_id not strictly increasing' }
			prev = eid
		}
		if (chain.length && curEpoch < chain[chain.length - 1].epoch_id)
			return { valid: false, reason: 'epoch_id regresses relative to epoch_chain tail' }
	}

	return { valid: true }
}
