import { Buffer } from 'node:buffer'

import { publicKeyFromSeed, sign } from '../crypto.mjs'
import {
	computeEventId,
	eventBodyForSign,
	signPayloadBytes,
	sortedPrevEventIds,
} from '../dag/index.mjs'
import { computeDagTipIdsFromEvents } from '../governance_branch.mjs'
import { nextHlc } from '../hlc.mjs'

/**
 * 为追加事件计算 HLC 与 DAG 前驱（chat 群与 social 时间线共用）。
 * @param {object[]} previous 已有事件
 * @param {object} event 待追加事件
 * @param {{ multiTip?: boolean }} [opts] chat 在多 tip 时连接全部 tip
 * @returns {{ hlc: object, prev_event_ids: string[], last: object | undefined }} HLC、前驱与末条事件
 */
export function computeAppendHlcAndPrev(previous, event, opts = {}) {
	const last = previous[previous.length - 1]
	const hlc = nextHlc(last?.hlc, event.timestamp ?? Date.now())
	const tips = computeDagTipIdsFromEvents(previous)
	let prev_event_ids
	if (event.prev_event_ids?.length)
		prev_event_ids = sortedPrevEventIds(event.prev_event_ids)
	else if (opts.multiTip && tips.length > 1)
		prev_event_ids = sortedPrevEventIds(tips)
	else if (tips.length)
		prev_event_ids = sortedPrevEventIds(tips)
	else if (last?.id)
		prev_event_ids = [last.id]
	else
		prev_event_ids = []
	return { hlc, prev_event_ids, last }
}

/**
 * 使用 eventBodyForSign 规范签名并返回完整事件（social 时间线）。
 * @param {object} base 事件基体（含 type/groupId/sender/hlc/prev_event_ids/content/node_id）
 * @param {Uint8Array} secretKey 签名密钥
 * @returns {object} 签名后事件
 */
export async function signTimelineEvent(base, secretKey) {
	const body = eventBodyForSign(base)
	const id = computeEventId(body)
	const signature = await sign(signPayloadBytes(body), secretKey)
	return {
		...base,
		id,
		signature: Buffer.from(signature).toString('hex'),
		senderPubKey: Buffer.from(publicKeyFromSeed(secretKey)).toString('hex'),
	}
}
