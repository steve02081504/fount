/**
 * 发现拓扑子模型：trusted 锚点 + explore 集 + eclipse 竞争填充。
 */

/**
 * @typedef {{
 *   trustedAnchors: Set<string>,
 *   exploreByObserver: Map<string, Set<string>>,
 *   poisonedByAttacker: Map<string, Set<string>>,
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
	}
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
	return explore
}

/**
 * eclipse 攻击：竞争填充受害者 explore 集。
 * @param {DiscoveryState} state 发现状态
 * @param {string} victimObserverId 受害观察者（以其视角建模）
 * @param {string} attackerId 攻击者
 * @param {string[]} sybilIds 同簇 sybil
 * @param {number} focus 填充强度 0..1
 * @returns {void}
 */
export function eclipseFillExplore(state, victimObserverId, attackerId, sybilIds, focus = 0.7) {
	const explore = state.exploreByObserver.get(victimObserverId) ?? new Set()
	const cap = Math.max(2, Math.round(explore.size * focus))
	let added = 0
	for (const id of [attackerId, ...sybilIds]) {
		if (added >= cap) break
		if (!explore.has(id)) {
			explore.add(id)
			added++
		}
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
	const explore = state.exploreByObserver.get(observerId) ?? state.trustedAnchors
	const anchors = [...state.trustedAnchors].filter(id => friendlyIds.includes(id))
	const adj = new Map(friendlyIds.map(id => [id, []]))
	for (const id of friendlyIds) {
		const peers = friendlyIds
			.filter(x => x !== id)
			.sort((a, b) => scoreOf(b) - scoreOf(a))
			.slice(0, 6)
		adj.set(id, peers)
	}
	const start = new Set([...anchors, ...explore].filter(id => friendlyIds.includes(id)))
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
	return target.length ? [...visited].filter(id => target.includes(id)).length / target.length : 0
}

/**
 * trusted 锚点恢复：清空 poison 并重新注入锚点 explore。
 * @param {DiscoveryState} state 发现状态
 * @param {string} observerId 观察者
 * @returns {void}
 */
export function recoverDiscoveryFromAnchors(state, observerId) {
	state.poisonedByAttacker.delete(observerId)
	const explore = new Set(state.trustedAnchors)
	state.exploreByObserver.set(observerId, explore)
}
