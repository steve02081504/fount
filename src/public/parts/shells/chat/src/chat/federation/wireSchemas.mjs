/** Trystero 联邦线入站解析：tip ping/pong、gossip_request、channel_history、fed_shun、partition bridge。 */
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { parsePullAttestation } from 'npm:@steve02081504/fount-p2p/schemas/federation_pull'
import { extractInboundSignedEvent, isPlainObject } from 'npm:@steve02081504/fount-p2p/wire/ingress'

import { isChannelIdValid } from '../lib/channelId.mjs'

import { PARTITION_BRIDGE_ACTIONS } from './partitionBridge.mjs'
import { EVENT_ID_HEX } from './registry.mjs'

/** @type {Set<string>} */
export const FED_SHUN_REASONS = new Set(['not_a_member', 'blocked'])

/** 频道 messages.jsonl 行类型（与 eventPersist 写入集合一致）。 */
const CHANNEL_HISTORY_ROW_TYPES = new Set([
	'message', 'message_edit', 'message_delete', 'message_feedback',
	'vote_cast', 'pin_message', 'unpin_message',
])

const CHANNEL_HISTORY_ROW_MAX_BYTES = 256 * 1024

/**
 * @param {unknown} payload Trystero 载荷
 * @returns {{ nodeHash: string, tips: unknown } | null} 解析结果
 */
export function parseFedTipPing(payload) {
	if (!isPlainObject(payload)) return null
	const nodeHash = normalizeHex64(payload.nodeHash)
	if (!isHex64(nodeHash)) return null
	return { nodeHash, tips: payload.tips, archiveSummary: payload.archiveSummary }
}

/**
 * @param {unknown} payload Trystero 载荷
 * @returns {{ tips: unknown } | null} 解析结果
 */
export function parseFedTipPong(payload) {
	if (!isPlainObject(payload)) return null
	const archiveSummary = isPlainObject(payload.archiveSummary) ? payload.archiveSummary : null
	return { tips: payload.tips, archiveSummary }
}

/**
 * @param {unknown} payload gossip_request 载荷
 * @returns {{ wantIds: string[], ttl: number, requesterNodeHash: string, archiveSummary: unknown, attestation: import('npm:@steve02081504/fount-p2p/schemas/federation_pull').PullAttestation } | null} 解析结果
 */
export function parseGossipRequest(payload) {
	if (!isPlainObject(payload)) return null
	const wantIds = Array.isArray(payload.wantIds)
		? [...new Set(payload.wantIds.map(id => String(id).trim().toLowerCase()).filter(id => EVENT_ID_HEX.test(id)))]
		: []
	if (!wantIds.length) return null
	const ttl = Number(payload.ttl)
	const requesterNodeHash = String(payload.requesterNodeHash || '').trim()
	const attestation = parsePullAttestation(payload.attestation)
	if (!Number.isFinite(ttl) || !requesterNodeHash || !attestation) return null
	if (attestation.wantIds?.length) {
		const attSet = new Set(attestation.wantIds)
		if (wantIds.some(id => !attSet.has(id))) return null
	}
	return { wantIds, ttl, requesterNodeHash, archiveSummary: payload.archiveSummary, attestation }
}

/**
 * @param {unknown} payload fed_shun 载荷
 * @param {string} groupId 群 ID
 * @returns {{ groupId: string, nodeHash: string, reason: string } | null} 解析结果
 */
export function parseFedShun(payload, groupId) {
	if (!isPlainObject(payload)) return null
	if (String(payload.groupId || '').trim() !== groupId) return null
	const nodeHash = String(payload.nodeHash || '').trim().toLowerCase()
	const reason = String(payload.reason || '').trim().toLowerCase()
	if (!isHex64(nodeHash) || !FED_SHUN_REASONS.has(reason)) return null
	return { groupId, nodeHash, reason }
}

/**
 * @param {unknown} payload channel_history_want 载荷
 * @param {string} localNodeHash 本节点 hash
 * @param {string} groupId 群 ID（attestation 校验用）
 * @returns {{ requesterNodeHash: string, requestId: string, channelId: string, before?: string, limit: number, attestation: import('npm:@steve02081504/fount-p2p/schemas/federation_pull').PullAttestation } | null} 解析结果
 */
export function parseChannelHistoryWant(payload, localNodeHash, groupId) {
	if (!isPlainObject(payload)) return null
	const requesterNodeHash = String(payload.requesterNodeHash || '').trim()
	const requestId = String(payload.requestId || '').trim()
	const channelId = String(payload.channelId || '').trim()
	const attestation = parsePullAttestation(payload.attestation)
	if (!requesterNodeHash || !requestId || !isChannelIdValid(channelId) || requesterNodeHash === localNodeHash)
		return null
	if (!attestation || attestation.groupId !== groupId || attestation.requestId !== requestId)
		return null
	const before = String(payload.before || '').trim()
	return {
		requesterNodeHash,
		requestId,
		channelId,
		before: EVENT_ID_HEX.test(before) ? before : undefined,
		limit: Math.min(500, Math.max(1, Number(payload.limit) || 50)),
		attestation,
	}
}

/**
 * @param {unknown} row 单条频道历史行
 * @returns {object | null} 验形后的行
 */
function parseChannelHistoryRow(row) {
	if (!isPlainObject(row)) return null
	const eventId = String(row.eventId || '').trim().toLowerCase()
	if (!EVENT_ID_HEX.test(eventId)) return null
	const type = String(row.type || '').trim()
	if (!CHANNEL_HISTORY_ROW_TYPES.has(type)) return null
	if (!isHex64(row.sender)) return null
	if (row.content == null) return null
	let encoded
	try { encoded = JSON.stringify(row) }
	catch { return null }
	if (encoded.length > CHANNEL_HISTORY_ROW_MAX_BYTES) return null
	return row
}

/**
 * @param {unknown} rows 远端频道历史行数组
 * @returns {object[]} 验形后的行
 */
export function parseChannelHistoryRows(rows) {
	if (!Array.isArray(rows)) return []
	return rows.map(parseChannelHistoryRow).filter(Boolean)
}

/**
 * @param {unknown} payload channel_history_response 载荷
 * @param {string} localNodeHash 本节点 hash
 * @returns {{ requestId: string, channelId: string, messages: object[] } | null} 解析结果
 */
export function parseChannelHistoryResponse(payload, localNodeHash) {
	if (!isPlainObject(payload)) return null
	if (String(payload.requesterNodeHash || '').trim() !== localNodeHash) return null
	const requestId = String(payload.requestId || '').trim()
	const channelId = String(payload.channelId || '').trim()
	if (!requestId || !isChannelIdValid(channelId)) return null
	return {
		requestId,
		channelId,
		messages: parseChannelHistoryRows(payload.messages),
	}
}

/**
 * @param {string} actionName partition bridge 目标 action
 * @param {unknown} payload 载荷
 * @param {string} groupId 群 ID
 * @returns {unknown | null} 验形后的载荷；非法 action 或验形失败为 null
 */
export function parsePartitionBridgePayload(actionName, payload, groupId) {
	if (!PARTITION_BRIDGE_ACTIONS.has(actionName)) return null
	return extractInboundSignedEvent(payload, groupId)
}
