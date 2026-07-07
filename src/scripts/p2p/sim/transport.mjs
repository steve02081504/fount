/**
 * 传输/信令层子模型：RTC 连接预算 + 信令源多样性（软加成，不强制多来源）。
 * 预算默认值直接派生自真实 rtc_connection_budget.mjs，避免与生产代码人肉脱钩。
 */
import { MAX_SOURCE_SLOT_FRACTION, resolveRtcBudgetLimits } from '../rtc_connection_budget.mjs'

import { buildRankedNeighborAdj } from './graph_adj.mjs'

/** 默认注册的信令/发现源（对齐真实 link_registry：mdns + nostr，bluetooth 默认关闭） */
export const DEFAULT_SIGNALING_SOURCES = Object.freeze(['mdns', 'nostr'])

/**
 * @returns {object} 传输状态
 */
export function createTransportState() {
	const limits = resolveRtcBudgetLimits()
	return {
		rtcMaxActive: limits.maxActive,
		maxJoinsPerMin: limits.maxJoinsPerMin,
		overloadCooldownMs: limits.overloadCooldownMs,
		trustedReserveFraction: limits.trustedReserveFraction,
		minTrustedReserved: limits.minTrustedReserved,
		sourceSlotFraction: MAX_SOURCE_SLOT_FRACTION,
		overloadUntil: 0,
		joinTimestamps: [],
		active: new Set(),
		sourceByPeer: new Map(),
		trustedPeers: new Set(),
		hintsByObserver: new Map(),
		signalingSources: [...DEFAULT_SIGNALING_SOURCES],
	}
}

/**
 * @param {ReturnType<typeof createTransportState>} state 传输状态
 * @param {string} observerId 观察者
 * @param {string} peerId 对端
 * @param {string} sourceId 信令/发现来源
 * @param {number} [weight=0.1] 基础权重
 * @returns {number} 有效权重（多来源软加成，单来源仍可连接）
 */
export function transportHintWeight(state, observerId, peerId, sourceId, weight = 0.1) {
	let bucket = state.hintsByObserver.get(observerId)
	if (!bucket) {
		bucket = new Map()
		state.hintsByObserver.set(observerId, bucket)
	}
	let row = bucket.get(peerId)
	if (!row) {
		row = { sources: new Set(), weight: 0, trusted: state.trustedPeers.has(peerId) }
		bucket.set(peerId, row)
	}
	row.sources.add(String(sourceId || 'peer'))
	const multiBoost = row.sources.size >= 2 ? 1.2 : 1
	row.weight = Math.max(row.weight, weight * multiBoost)
	return row.weight
}

/**
 * @param {ReturnType<typeof createTransportState>} state 传输状态
 * @param {string} peerId 对端
 * @param {string} sourceId 来源
 * @param {number} now 当前时间
 * @returns {boolean} 是否占槽成功
 */
export function takeTransportJoinSlot(state, peerId, sourceId, now = Date.now()) {
	const cooldown = state.overloadCooldownMs ?? 15_000
	if (now < state.overloadUntil) return false
	state.joinTimestamps = state.joinTimestamps.filter(t => now - t < 60_000)
	if (state.joinTimestamps.length >= state.maxJoinsPerMin) {
		state.overloadUntil = now + cooldown
		return false
	}
	if (peerId && state.active.has(peerId)) return true
	const isTrusted = peerId && state.trustedPeers.has(peerId)
	const trustedReserved = Math.max(state.minTrustedReserved ?? 3, Math.floor(state.rtcMaxActive * (state.trustedReserveFraction ?? 0.25)))
	const maxNonTrusted = Math.max(1, state.rtcMaxActive - trustedReserved)
	const nonTrusted = [...state.active].filter(id => !state.trustedPeers.has(id)).length
	if (!isTrusted) {
		const sameSource = [...state.sourceByPeer.values()].filter(s => s === sourceId).length
		const sourceCap = Math.max(1, Math.floor(state.rtcMaxActive * (state.sourceSlotFraction ?? 0.25)))
		if (sameSource >= sourceCap) return false
		if (nonTrusted >= maxNonTrusted && state.active.size >= state.rtcMaxActive) {
			state.overloadUntil = now + cooldown
			return false
		}
	}
	if (state.active.size >= state.rtcMaxActive && !isTrusted) {
		state.overloadUntil = now + cooldown
		return false
	}
	state.joinTimestamps.push(now)
	if (peerId) {
		state.active.add(peerId)
		state.sourceByPeer.set(peerId, String(sourceId || 'peer'))
	}
	return true
}

/**
 * @param {ReturnType<typeof createTransportState>} state 传输状态
 * @param {string} observerId 观察者
 * @param {string[]} friendlyIds 友善节点
 * @param {(id: string) => number} scoreOf 信誉分
 * @param {number} [now=Date.now()] 当前时间（仿真须传 ctx.now，与 takeTransportJoinSlot 同一时钟）
 * @returns {{ reach: number, diversity: number, throttleOk: number }} 传输指标
 */
export function transportMetrics(state, observerId, friendlyIds, scoreOf, now = Date.now()) {
	const bucket = state.hintsByObserver.get(observerId) ?? new Map()
	const adj = buildRankedNeighborAdj(friendlyIds, scoreOf, 6)
	const visited = new Set([observerId])
	let frontier = [observerId]
	for (let hop = 0; hop < 4 && frontier.length; hop++) {
		const next = []
		for (const id of frontier)
			for (const peer of adj.get(id) ?? []) {
				if (visited.has(peer)) continue
				visited.add(peer)
				next.push(peer)
			}
		frontier = next
	}
	const target = friendlyIds.filter(id => id !== observerId)
	const reach = target.length ? [...visited].filter(id => target.includes(id)).length / target.length : 0
	let diversitySum = 0
	let diversityN = 0
	for (const [peerId, row] of bucket) {
		if (!target.includes(peerId)) continue
		diversitySum += Math.min(1, row.sources.size / Math.max(1, state.signalingSources.length))
		diversityN++
	}
	const diversity = diversityN ? diversitySum / diversityN : 1
	const throttleOk = state.overloadUntil > now ? 0 : 1
	return { reach, diversity, throttleOk }
}
