/**
 * 发现拓扑子模型：单 relay rendezvous + RTC 连接预算 + explore 源配额 + trusted 锚点。
 */
import { buildRankedNeighborAdj } from './graph_adj.mjs'

/** 单 explore 源最多占用的 room 槽位（对齐 peer_pool EXPLORE_MAX_PER_SOURCE） */
export const EXPLORE_MAX_PER_SOURCE = 3

/** 默认 RTC room 并发连接上限 */
export const DEFAULT_RTC_MAX_ACTIVE = 32

/**
 * @typedef {{
 *   trustedAnchors: Set<string>,
 *   exploreByObserver: Map<string, Set<string>>,
 *   poisonedByAttacker: Map<string, Set<string>>,
 *   roomSlotsByObserver: Map<string, { active: Set<string>, sourceByPeer: Map<string, string>, trustedReserved: Set<string> }>,
 *   rtcMaxActive: number,
 * }} DiscoveryState
 */

/**
 * @returns {DiscoveryState} 空发现状态
 */
export function createDiscoveryState() {
	return {
		trustedAnchors: new Set(),
		exploreByObserver: new Map(),
		poisonedByAttacker: new Map(),
		roomSlotsByObserver: new Map(),
		rtcMaxActive: DEFAULT_RTC_MAX_ACTIVE,
	}
}

/**
 * @param {DiscoveryState} state 发现状态
 * @param {string} observerId 观察者
 * @returns {{ active: Set<string>, sourceByPeer: Map<string, string>, trustedReserved: Set<string> }} room 槽位桶
 */
function roomBucket(state, observerId) {
	let bucket = state.roomSlotsByObserver.get(observerId)
	if (!bucket) {
		bucket = { active: new Set(), sourceByPeer: new Map(), trustedReserved: new Set() }
		state.roomSlotsByObserver.set(observerId, bucket)
	}
	return bucket
}

/**
 * @param {DiscoveryState} state 发现状态
 * @param {string} observerId 观察者
 * @param {string[]} trusted 锚点
 * @param {string[]} roster 在线名册
 * @param {() => number} rng 随机源
 * @param {number} exploreCap explore 容量
 * @returns {Set<string>} 观察者可见 peer 集
 */
export function initObserverDiscovery(state, observerId, trusted, roster, rng, exploreCap = 8) {
	state.trustedAnchors = new Set(trusted)
	const explore = new Set(trusted)
	const pool = roster.filter(id => id !== observerId && !explore.has(id))
	while (explore.size < exploreCap + trusted.length && pool.length) {
		const i = Math.floor(rng() * pool.length)
		explore.add(pool.splice(i, 1)[0])
	}
	state.exploreByObserver.set(observerId, explore)

	const bucket = roomBucket(state, observerId)
	for (const id of trusted) {
		bucket.trustedReserved.add(id)
		bucket.active.add(id)
		bucket.sourceByPeer.set(id, 'trusted')
	}
	for (const id of explore) {
		if (bucket.active.size >= state.rtcMaxActive) break
		if (bucket.active.has(id)) continue
		takeRoomSlot(state, observerId, id, 'explore', trusted)
	}
	return explore
}

/**
 * 占用 RTC room 槽位；trusted 锚点优先保留，单源 explore 有配额。
 * @param {DiscoveryState} state 发现状态
 * @param {string} observerId 观察者
 * @param {string} peerId 对端
 * @param {string} sourceId 来源标识
 * @param {string[]} [trustedIds=[]] trusted 锚点
 * @returns {boolean} 是否成功占槽
 */
export function takeRoomSlot(state, observerId, peerId, sourceId, trustedIds = []) {
	const bucket = roomBucket(state, observerId)
	if (bucket.active.has(peerId)) return true

	const isTrusted = trustedIds.includes(peerId) || bucket.trustedReserved.has(peerId)
	if (!isTrusted) {
		const sourceCount = [...bucket.sourceByPeer.values()].filter(s => s === sourceId).length
		if (sourceCount >= EXPLORE_MAX_PER_SOURCE) return false
	}

	const maxActive = state.rtcMaxActive
	const trustedCount = bucket.trustedReserved.size
	const nonTrustedActive = [...bucket.active].filter(id => !bucket.trustedReserved.has(id)).length
	const maxNonTrusted = Math.max(0, maxActive - trustedCount)

	if (!isTrusted && nonTrustedActive >= maxNonTrusted) {
		if (bucket.active.size >= maxActive) return false
	}

	if (bucket.active.size >= maxActive && !isTrusted) return false

	bucket.active.add(peerId)
	bucket.sourceByPeer.set(peerId, sourceId)
	if (isTrusted) bucket.trustedReserved.add(peerId)
	return true
}

/**
 * eclipse 攻击：Sybil 灌满 room 槽位并污染 explore。
 * @param {DiscoveryState} state 发现状态
 * @param {string} victimObserverId 受害观察者
 * @param {string} attackerId 攻击者
 * @param {string[]} sybilIds 同簇 sybil
 * @param {number} focus 填充强度 0..1
 * @returns {void}
 */
export function eclipseFillExplore(state, victimObserverId, attackerId, sybilIds, focus = 0.7) {
	const explore = state.exploreByObserver.get(victimObserverId) ?? new Set()
	const cap = Math.max(2, Math.round(explore.size * focus))
	let added = 0
	const sybilSource = `eclipse:${attackerId}`
	for (const id of [attackerId, ...sybilIds]) {
		if (added >= cap) break
		if (!explore.has(id)) {
			explore.add(id)
			added++
		}
		takeRoomSlot(state, victimObserverId, id, sybilSource, [...state.trustedAnchors])
	}
	const poison = state.poisonedByAttacker.get(victimObserverId) ?? new Set()
	poison.add(attackerId)
	state.poisonedByAttacker.set(victimObserverId, poison)
	state.exploreByObserver.set(victimObserverId, explore)
}

/**
 * @param {DiscoveryState} state 发现状态
 * @param {string} observerId 观察者
 * @param {string[]} friendlyIds 友善节点
 * @param {(id: string) => number} scoreOf 信誉分
 * @param {number} maxHop 最大跳
 * @returns {number} 可达友善节点比例 0..1
 */
export function discoveryReach(state, observerId, friendlyIds, scoreOf, maxHop = 4) {
	const bucket = roomBucket(state, observerId)
	const roomPeers = [...bucket.active].filter(id => friendlyIds.includes(id))
	const explore = state.exploreByObserver.get(observerId) ?? state.trustedAnchors
	const anchors = [...state.trustedAnchors].filter(id => friendlyIds.includes(id))
	const adj = buildRankedNeighborAdj(friendlyIds, scoreOf, 6)
	const start = new Set([...anchors, ...roomPeers, ...explore].filter(id => friendlyIds.includes(id)))
	if (!start.size) return 0
	const visited = new Set(start)
	let frontier = [...start]
	for (let hop = 0; hop < maxHop && frontier.length; hop++) {
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
	const rawReach = target.length ? [...visited].filter(id => target.includes(id)).length / target.length : 0
	const slotFill = bucket.active.size / Math.max(1, state.rtcMaxActive)
	const sybilDominated = [...bucket.sourceByPeer.values()].filter(s => String(s).startsWith('eclipse:')).length
	const sybilRatio = sybilDominated / Math.max(1, bucket.active.size)
	return rawReach * Math.max(0.05, 1 - sybilRatio * 0.85) * Math.max(0.2, 1 - Math.max(0, slotFill - 0.75) * 2)
}

/**
 * trusted 锚点恢复：清空 poison、释放非 trusted 槽位并重新注入锚点 explore。
 * @param {DiscoveryState} state 发现状态
 * @param {string} observerId 观察者
 * @returns {void}
 */
export function recoverDiscoveryFromAnchors(state, observerId) {
	state.poisonedByAttacker.delete(observerId)
	const explore = new Set(state.trustedAnchors)
	state.exploreByObserver.set(observerId, explore)
	const bucket = roomBucket(state, observerId)
	const keep = new Set(state.trustedAnchors)
	bucket.active = new Set(keep)
	bucket.sourceByPeer = new Map([...keep].map(id => [id, 'trusted']))
	bucket.trustedReserved = new Set(keep)
}

/**
 * @param {DiscoveryState} state 发现状态
 * @param {string} observerId 观察者
 * @returns {number} room 槽位占用率 0..1
 */
export function roomSlotFillRate(state, observerId) {
	const bucket = state.roomSlotsByObserver.get(observerId)
	if (!bucket) return 0
	return bucket.active.size / Math.max(1, state.rtcMaxActive)
}
