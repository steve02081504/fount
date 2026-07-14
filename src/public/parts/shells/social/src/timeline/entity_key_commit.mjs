import { Buffer } from 'node:buffer'

import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { pubKeyHash, publicKeyFromSeed } from 'npm:@steve02081504/fount-p2p/crypto'
import { appendJsonlSynced, readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { computeAppendHlcAndPrev, signTimelineEvent } from 'npm:@steve02081504/fount-p2p/timeline/append_core'

import { getEntitySecretKey } from '../../../../../../server/p2p_server/entity_identity.mjs'
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
 * @param {string} entityHash 128 hex
 * @returns {Promise<{ sender: string, secretKey: Uint8Array }>} 实体活跃钥签名者
 */
async function resolveEntityTimelineSigner(username, entityHash) {
	const secretHex = await getEntitySecretKey(username, entityHash)
	if (!secretHex || secretHex.length !== 64) throw new Error('configure entity identity before key commit')
	const secretKey = new Uint8Array(Buffer.from(secretHex, 'hex'))
	return timelineSignerFromSecret(secretKey)
}

/**
 * @param {string} username replica
 * @param {string} entityHash 128 hex
 * @returns {Promise<void>}
 */
async function assertWritableEntityTimeline(username, entityHash) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed || parsed.nodeHash !== getNodeHash()) throw new Error('cannot write timeline for this entity on this replica')
	await resolveEntityTimelineSigner(username, entityHash)
}

/**
 * @param {string} username replica
 * @param {string} entityHash 128 hex
 * @param {object} event 未签名事件
 * @param {Uint8Array} secretKey 签名私钥
 * @returns {Promise<object>} 签名事件
 */
async function appendSignedEntityTimelineEvent(username, entityHash, event, secretKey) {
	await assertWritableEntityTimeline(username, entityHash)
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
 * 主动轮换实体活跃钥并广播时间线事件。
 * @param {string} username replica
 * @param {string} entityHash 实体 entityHash
 * @param {object} rotation 轮换结果
 * @returns {Promise<object>} 签名事件
 */
export async function commitEntityKeyRotate(username, entityHash, rotation) {
	const { secretKey } = await resolveEntityTimelineSigner(username, entityHash)
	const signed = await appendSignedEntityTimelineEvent(username, entityHash, {
		type: 'entity_key_rotate',
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
 * @param {string} entityHash 实体 entityHash
 * @param {object} revokeBody 吊销正文
 * @param {Uint8Array} recoverySecretKey recovery 私钥
 * @returns {Promise<object>} revoke 事件
 */
export async function commitEntityKeyRevoke(username, entityHash, revokeBody, recoverySecretKey) {
	const signed = await appendSignedEntityTimelineEvent(username, entityHash, {
		type: 'entity_key_revoke',
		content: revokeBody,
	}, recoverySecretKey)
	await publishTimelineEvent(username, entityHash, signed)
	return signed
}
