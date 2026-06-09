/**
 * 本地 DAG 事件签名（HLC + Ed25519 + 校验），不含落盘与副作用。
 */
import { Buffer } from 'node:buffer'

import { publicKeyFromSeed, sign } from '../../../../../../../scripts/p2p/crypto.mjs'
import {
	computeEventId,
	signPayloadBytes,
} from '../../../../../../../scripts/p2p/dag/index.mjs'
import { getNodeHash } from '../../../../../../../scripts/p2p/node_context.mjs'
import {
	classifyHlcSkewAction,
	resolveHlcMaxSkewMs,
} from '../events/hlcPolicy.mjs'

import { canonicalizeSignedChatEvent } from './canonicalizeEvent.mjs'
import { unsignedEventFields, validateSignature } from './validator.mjs'

/**
 * @param {object} params 签名参数
 * @param {string} params.username replica
 * @param {string} params.groupId 群 ID
 * @param {object} params.event 待签名事件体（含 sender）
 * @param {Uint8Array} params.secretKey 签名种子
 * @param {object} params.state 物化群状态
 * @param {object} params.hlc HLC
 * @param {string[]} params.prev_event_ids DAG 父 tip
 * @returns {Promise<{ signPayload: object, wirePayload: object }>} 签名载荷与 canonical 行
 */
export async function signLocalChatEvent({ groupId, event, secretKey, state, hlc, prev_event_ids, username }) {
	const base = {
		...event,
		groupId,
		hlc,
		prev_event_ids,
		node_id: event.node_id || getNodeHash(username),
	}
	const body = unsignedEventFields(base)
	const id = computeEventId(body)
	const signature = await sign(signPayloadBytes(body), secretKey)
	const signPayload = {
		...body,
		id,
		signature: Buffer.from(signature).toString('hex'),
		senderPubKey: Buffer.from(publicKeyFromSeed(secretKey)).toString('hex'),
	}

	const maxSkewMs = resolveHlcMaxSkewMs(state)
	const hlcAction = classifyHlcSkewAction(signPayload, maxSkewMs, { source: 'local' })
	if (hlcAction !== 'allow')
		throw new Error(`event HLC skew too large (${signPayload.type}, max ${maxSkewMs}ms)`)
	await validateSignature(body, signPayload, event, secretKey, state)

	return {
		signPayload,
		wirePayload: canonicalizeSignedChatEvent(signPayload),
	}
}
