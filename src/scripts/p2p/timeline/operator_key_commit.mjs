import { Buffer } from 'node:buffer'

import {
	getOperatorSecretKey,
} from '../../../server/p2p_server/operator_identity.mjs'
import { pubKeyHash, publicKeyFromSeed } from '../crypto.mjs'
import { SOCIAL_TIMELINE_ROW_OPTS } from '../dag/canonicalize_presets.mjs'
import { canonicalizeSignedRow } from '../dag/canonicalizeRow.mjs'
import { appendJsonlSynced, readJsonl } from '../dag/storage.mjs'
import { parseEntityHash } from '../entity_id.mjs'
import { getNodeHash } from '../node/identity.mjs'
import { publishTimelineEvent } from '../part_wire_fanout.mjs'
import { timelineGroupId } from '../social_namespace.mjs'

import { computeAppendHlcAndPrev, signTimelineEvent } from './append_core.mjs'
import { operatorTimelineEventsPath } from './paths.mjs'


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
 * @param {object} event 签名事件
 * @returns {object} canonical 行
 */
function canonicalizeLocalTimelineEvent(event) {
	return canonicalizeSignedRow(event, SOCIAL_TIMELINE_ROW_OPTS)
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
	const groupId = timelineGroupId(entityHash)
	const previous = await readJsonl(operatorTimelineEventsPath(username, entityHash))
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
	await appendJsonlSynced(operatorTimelineEventsPath(username, entityHash), row)
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
