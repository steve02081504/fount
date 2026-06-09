/**
 * DAG checkpoint 结构校验与群主/管理员签名验签（联邦采纳前置条件）。
 */
import { Buffer } from 'node:buffer'

import { verifyCheckpointSignature } from '../../../../../../../scripts/p2p/checkpoint.mjs'
import { merkleRoot } from '../../../../../../../scripts/p2p/dag/index.mjs'
import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { checkpointSignerPubKeyHashes } from '../../../../../../../scripts/p2p/materialized_state.mjs'
import { isPlainObject } from '../../../../../../../scripts/p2p/wire_ingress.mjs'

/**
 * @param {object} checkpoint 远端 checkpoint
 * @returns {Buffer[]} 可验签的 Ed25519 公钥（32 字节）
 */
function checkpointSignerPubKeys(checkpoint) {
	const record = checkpoint.members_record
	if (!isPlainObject(record) || !isPlainObject(record.members)) return []
	const state = {
		delegatedOwnerPubKeyHash: record.delegatedOwnerPubKeyHash,
		members: record.members,
		roles: record.roles,
	}
	/** @type {Buffer[]} */
	const keys = []
	for (const hash of checkpointSignerPubKeyHashes(state)) {
		const hex = String(record.members[hash]?.pubKeyHex || '').trim()
		if (hex.length === 64) keys.push(Buffer.from(hex, 'hex'))
	}
	return keys
}

/**
 * @param {object} checkpoint 远端 checkpoint 对象
 * @returns {Promise<{ valid: boolean, reason?: string }>} 校验结果与失败原因
 */
export async function verifyRemoteCheckpoint(checkpoint) {
	if (!isPlainObject(checkpoint))
		return { valid: false, reason: 'checkpoint missing or not an object' }

	const ids = checkpoint.eventIdsInEpoch
	if (!Array.isArray(ids) || !ids.length)
		return { valid: false, reason: 'eventIdsInEpoch missing or empty' }
	if (!ids.every(isHex64))
		return { valid: false, reason: 'eventIdsInEpoch contains invalid event id' }

	const expectedRoot = merkleRoot(ids)
	if (checkpoint.epoch_root_hash !== expectedRoot)
		return { valid: false, reason: 'epoch_root_hash does not match Merkle root of eventIdsInEpoch' }

	if (!/^[\da-f]{128}$/iu.test(String(checkpoint.checkpoint_signature || '').trim()))
		return { valid: false, reason: 'checkpoint_signature required' }

	const pubKeys = checkpointSignerPubKeys(checkpoint)
	if (!pubKeys.length)
		return { valid: false, reason: 'checkpoint signer unknown' }

	let signed = false
	for (const pubKey of pubKeys) 
		if (await verifyCheckpointSignature(checkpoint, pubKey)) {
			signed = true
			break
		}
	
	if (!signed) return { valid: false, reason: 'checkpoint_signature verification failed' }

	const curEpoch = checkpoint.epoch_id
	if (typeof curEpoch !== 'number' || !Number.isFinite(curEpoch) || curEpoch <= 0 || curEpoch !== Math.floor(curEpoch))
		return { valid: false, reason: 'epoch_id invalid' }

	const chain = checkpoint.epoch_chain
	if (chain != null) {
		if (!Array.isArray(chain))
			return { valid: false, reason: 'epoch_chain is not an array' }
		let prev = -Infinity
		for (let index = 0; index < chain.length; index++) {
			const entry = chain[index]
			if (!isPlainObject(entry))
				return { valid: false, reason: 'epoch_chain entry invalid' }
			const eid = entry.epoch_id
			const erh = entry.epoch_root_hash
			const cid = entry.checkpoint_event_id
			if (typeof eid !== 'number' || !Number.isFinite(eid) || eid <= 0 || eid !== Math.floor(eid))
				return { valid: false, reason: 'epoch_chain epoch_id invalid' }
			if (!isHex64(erh))
				return { valid: false, reason: 'epoch_chain epoch_root_hash invalid' }
			if (!isHex64(cid))
				return { valid: false, reason: 'epoch_chain checkpoint_event_id invalid' }
			if (eid <= prev) return { valid: false, reason: 'epoch_chain epoch_id not strictly increasing' }
			prev = eid
		}
		if (chain.length && curEpoch < chain[chain.length - 1].epoch_id)
			return { valid: false, reason: 'epoch_id regresses relative to epoch_chain tail' }
	}

	return { valid: true }
}
