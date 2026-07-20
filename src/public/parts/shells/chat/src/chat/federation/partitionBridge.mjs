import { createHash } from 'node:crypto'

import { createDedupeSlot } from 'npm:@steve02081504/fount-p2p/federation/dedupe_slot'
import { isRtcRoomOverloaded } from 'npm:@steve02081504/fount-p2p/transport/rtc_connection_budget'
import { consumeWireRateBucket } from 'npm:@steve02081504/fount-p2p/wire/rate_bucket'

const takeBridgeDedupeSlot = createDedupeSlot({ maxSize: 5000, ttlMs: 30_000 })
const DEFAULT_BRIDGE_TTL = 2

/** 分区桥接允许转发且已在入站处验形的联邦 action。 */
export const PARTITION_BRIDGE_ACTIONS = new Set(['dag_event'])

/** 桥接优先级：数字越小越关键（过载时丢弃高数字） */
export const BRIDGE_ACTION_PRIORITY = {
	dag_event: 0,
	part_invoke: 4,
	gossip_request: 5,
	gossip_response: 5,
	fed_chunk_data: 6,
	fed_chunk_get: 6,
	fed_partition_bridge: 8,
}

const BRIDGE_FORWARD_MAX_PER_MIN = 120

/**
 * @param {string} key 去重键
 * @returns {boolean} 首次见到为 true
 */
export function takePartitionBridgeSlot(key) {
	return takeBridgeDedupeSlot(key)
}

/**
 * @param {unknown} payload 桥接 action 载荷
 * @param {string} actionName 联邦 action
 * @returns {string} 出站 dedupe id
 */
function buildPartitionBridgeDedupeId(payload, actionName) {
	return createHash('sha256').update(JSON.stringify({ payload, action: actionName }), 'utf8').digest('hex')
}

/**
 * @param {object} envelope 桥接载荷
 * @returns {string | null} 入站 dedupe id；缺字段为 null
 */
export function partitionBridgeDedupeId(envelope) {
	if (!envelope?.dedupeId) return null
	return String(envelope.dedupeId)
}

/**
 * @param {object} options 参数
 * @param {string} options.sourcePartition 来源分区
 * @param {string} options.targetPartition 目标分区
 * @param {string} options.actionName 联邦 action
 * @param {unknown} options.payload 载荷
 * @param {number} [options.ttl] 剩余跳数
 * @returns {object} 桥接信封
 */
export function buildPartitionBridgeEnvelope(options) {
	return {
		sourcePartition: options.sourcePartition,
		targetPartition: options.targetPartition,
		actionName: options.actionName,
		payload: options.payload,
		ttl: Math.max(0, Number(options.ttl ?? DEFAULT_BRIDGE_TTL)),
		dedupeId: buildPartitionBridgeDedupeId(options.payload, options.actionName),
	}
}

/**
 * @param {string} actionName 联邦 action
 * @returns {number} 优先级（越大越先丢弃）
 */
export function partitionBridgeActionPriority(actionName) {
	return BRIDGE_ACTION_PRIORITY[actionName] ?? 5
}

/**
 * @param {string} roomKey 房间键
 * @param {string} actionName action
 * @param {object} [rtcLimits] RTC 限额
 * @returns {boolean} 过载时是否应丢弃该桥接
 */
export function shouldDropPartitionBridgeUnderLoad(roomKey, actionName, rtcLimits = {}) {
	if (!isRtcRoomOverloaded(roomKey, rtcLimits)) return false
	return partitionBridgeActionPriority(actionName) >= 4
}

/**
 * @param {string} roomKey 房间键
 * @returns {boolean} 是否允许继续转发桥接包
 */
export function takePartitionBridgeForwardSlot(roomKey) {
	return consumeWireRateBucket(`partition_bridge_fwd:${roomKey}`, {
		maxCount: BRIDGE_FORWARD_MAX_PER_MIN,
	})
}

/**
 * 经已连接分区向目标分区桥接 action。
 * @param {object} slot 源分区 FederationSlot（含 sendPartitionBridge）
 * @param {object} options 参数
 * @param {string} options.targetPartition 目标分区
 * @param {string} options.actionName action
 * @param {unknown} options.payload 载荷
 * @param {string | null} [options.peerId] 目标 peer；null 为房内广播
 * @param {number} [options.ttl] TTL
 * @returns {boolean} 是否已发送
 */
export function sendPartitionBridgeFromSlot(slot, options) {
	if (!slot?.send) return false
	const envelope = buildPartitionBridgeEnvelope({
		sourcePartition: slot.partitionId,
		targetPartition: options.targetPartition,
		actionName: options.actionName,
		payload: options.payload,
		ttl: options.ttl,
	})
	slot.send('fed_partition_bridge', envelope, options.peerId ?? null)
	return true
}
