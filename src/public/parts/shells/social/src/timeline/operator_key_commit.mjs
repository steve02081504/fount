import { Buffer } from 'node:buffer'

import { pubKeyHash, publicKeyFromSeed } from '../../../../../../scripts/p2p/crypto.mjs'
import { appendJsonlSynced, readJsonl } from '../../../../../../scripts/p2p/dag/storage.mjs'
import { parseEntityHash } from '../../../../../../scripts/p2p/entity_id.mjs'
import { getNodeHash } from '../../../../../../scripts/p2p/node/identity.mjs'
import { computeAppendHlcAndPrev, signTimelineEvent } from '../../../../../../scripts/p2p/timeline/append_core.mjs'
import { getOperatorSecretKey } from '../../../../../../server/p2p_server/operator_identity.mjs'
import { groupIdForTimeline, timelineEventsPath } from '../paths.mjs'

import { canonicalizeLocalTimelineEvent } from './canonicalizeEvent.mjs'
import { publishTimelineEvent } from './fanout.mjs'

const NODE_ID = 'social-local'

/**
 * @param {Uint8Array} secretKey 私钥
 * @returns {{ sender: string, secretKey: Uint8Array }} 签名者
 */
function timelineSignerFromSecret(secretKey) {
	return { sender: pubKeyHash(publicKeyFromSeed(secretKey)), secretKey }
}

/**
 * @param {string} username replica
 * @returns {Promise<{ sender: string, secretKey: Uint8Array }>} 活跃钥签名者
 */
async function resolveActiveTimelineSigner(username) {
	const secretHex = await getOperatorSecretKey(username)
	if (!secretHex || secretHex.length !== 64) throw new Error('configure federation identity before posting')
	const secretKey = new Uint8Array(Buffer.from(secretHex, 'hex'))
	return timelineSignerFromSecret(secretKey)
}

/**
 * @param {string} username replica
 * @param {string} entityHash 128 hex
 * @returns {Promise<void>}
 */
async function assertWritableOperatorTimeline(username, entityHash) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed || parsed.nodeHash !== getNodeHash()) throw new Error('cannot write timeline for this entity on this replica')
	await resolveActiveTimelineSigner(username)
}

/**
 * @param {string} username replica
 * @param {string} entityHash operator entityHash
 * @param {object} event 未签名事件
 * @param {Uint8Array} secretKey 签名私钥
 * @returns {Promise<object>} 签名事件
 */
async function appendSignedOperatorTimelineEvent(username, entityHash, event, secretKey) {
	await assertWritableOperatorTimeline(username, entityHash)
	const groupId = groupIdForTimeline(entityHash)
	const previous = await readJsonl(timelineEventsPath(username, entityHash))
	const { hlc, prev_event_ids } = computeAppendHlcAndPrev(previous, event)
	const { sender } = timelineSignerFromSecret(secretKey)
	const base = {
		type: event.type,
		groupId,
		sender,
		charId: event.charId ?? null,
		timestamp: event.timestamp ?? Date.now(),
		hlc,
		prev_event_ids,
		content: event.content ?? {},
		node_id: NODE_ID,
	}
	const signed = await signTimelineEvent(base, secretKey)
	const row = canonicalizeLocalTimelineEvent(signed)
	await appendJsonlSynced(timelineEventsPath(username, entityHash), row)
	return row
}

/**
 * 主动轮换 operator 活跃钥并广播时间线事件。
 * @param {string} username replica
 * @param {string} entityHash operator entityHash
 * @param {object} rotation 轮换结果
 * @returns {Promise<object>} 签名事件
 */
export async function commitOperatorKeyRotate(username, entityHash, rotation) {
	const { secretKey } = await resolveActiveTimelineSigner(username)
	const signed = await appendSignedOperatorTimelineEvent(username, entityHash, {
		type: 'operator_key_rotate',
		content: {
			generation: rotation.keyGeneration,
			activePubKeyHex: rotation.activePubKeyHex,
			prevGeneration: rotation.prevGeneration,
		},
	}, secretKey)
	await publishTimelineEvent(username, entityHash, signed)
	return signed
}

/**
 * recovery 钥签发 revoke + 新活跃钥。
 * @param {string} username replica
 * @param {string} entityHash operator entityHash
 * @param {object} revokeBody 吊销正文
 * @param {Uint8Array} recoverySecretKey recovery 私钥
 * @returns {Promise<object>} revoke 事件
 */
export async function commitOperatorKeyRevoke(username, entityHash, revokeBody, recoverySecretKey) {
	const signed = await appendSignedOperatorTimelineEvent(username, entityHash, {
		type: 'operator_key_revoke',
		content: revokeBody,
	}, recoverySecretKey)
	await publishTimelineEvent(username, entityHash, signed)
	return signed
}
