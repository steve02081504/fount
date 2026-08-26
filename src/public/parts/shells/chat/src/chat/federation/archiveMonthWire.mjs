/**
 * 冷归档按月联邦 wire 解析（无 DAG/peerPool 依赖，供单元测试 import）。
 */
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { isPlainObject } from 'npm:@steve02081504/fount-p2p/core/object'

import { parseArchiveMonthWireParts } from '../archive/monthChunks.mjs'

/**
 * @param {unknown} payload wire 载荷
 * @returns {object | null} 解析后的 want
 */
export function parseFedArchiveMonthWant(payload) {
	if (!isPlainObject(payload)) return null
	const groupId = payload.groupId
	const channelId = payload.channelId
	const utcMonth = payload.utcMonth
	const requestId = payload.requestId
	const attestation = isPlainObject(payload.attestation) ? payload.attestation : null
	if (!groupId || !channelId || !/^\d{4}-\d{2}$/u.test(utcMonth) || !requestId || !attestation)
		return null
	return {
		groupId,
		channelId,
		utcMonth,
		requestId,
		requesterNodeHash: payload.requesterNodeHash,
		attestation,
	}
}

/**
 * @param {unknown} payload wire 载荷
 * @returns {object | null} 解析后的 response
 */
export function parseFedArchiveMonthResponse(payload) {
	if (!isPlainObject(payload)) return null
	const requestId = payload.requestId
	const channelId = payload.channelId
	const utcMonth = payload.utcMonth
	if (!requestId || !channelId || !/^\d{4}-\d{2}$/u.test(utcMonth)) return null
	if ('body' in payload) return null
	if (payload.complete !== true && payload.complete !== false) return null
	const complete = payload.complete === true
	const digest = payload.digest
	const parts = complete
		? parseArchiveMonthWireParts(payload.parts) ?? null
		: []
	if (complete && (!isHex64(digest) || parts === null)) return null
	return {
		requestId,
		channelId,
		utcMonth,
		digest: complete ? digest : '',
		parts: complete ? parts : [],
		complete,
		reason: payload.reason,
	}
}
