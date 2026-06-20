/**
 * 信誉信号异步传播（去全知 slash）。
 */

/**
 * @typedef {{ targetId: string, senderId: string, claim: number, verified: boolean, birthRound: number, spread: number }} PropagatedSlash
 */

/**
 * @returns {{ queue: PropagatedSlash[], delivered: Set<string> }} 传播状态
 */
export function createPropagationState() {
	return { queue: [], delivered: new Set() }
}

/**
 * @param {{ queue: PropagatedSlash[] }} state 传播状态
 * @param {PropagatedSlash} alert slash 警报
 * @returns {void}
 */
export function enqueueSlash(state, alert) {
	state.queue.push(alert)
}

/**
 * @param {object} state 传播状态
 * @param {number} round 当前回合
 * @param {(target: string, sender: string, claim: number, verified: boolean) => void} apply 应用到观察者
 * @param {(senderId: string) => number} trustOf 发送者信任
 * @param {number} [fanout=0.35] 每跳扩散概率基数
 * @param {() => number} [rng] 随机源
 * @returns {number} 本回合送达数
 */
export function tickPropagation(state, round, apply, trustOf, fanout = 0.35, rng = () => Math.random()) {
	let delivered = 0
	/** @type {PropagatedSlash[]} */
	const remaining = []
	for (const alert of state.queue) {
		const age = round - alert.birthRound
		if (age < alert.spread) {
			remaining.push(alert)
			continue
		}
		const key = `${alert.targetId}:${alert.senderId}:${alert.verified}:${alert.claim}`
		if (state.delivered.has(key)) continue
		const p = Math.min(0.95, fanout * Math.max(0.05, trustOf(alert.senderId)))
		if (rng() > p) {
			remaining.push({ ...alert, spread: alert.spread + 1 })
			continue
		}
		state.delivered.add(key)
		apply(alert.targetId, alert.senderId, alert.claim, alert.verified)
		delivered++
	}
	state.queue = remaining
	return delivered
}
