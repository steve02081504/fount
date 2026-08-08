/**
 * 入场 / 保持 / 退场阶段生成器。
 */

import { renderBuffers } from '../compose/index.mjs'
import { clearDynamics } from '../fluid/world/index.mjs'
import { maxBodyD, maxPillarH } from '../icon.mjs'

import { createAnimState } from './create.mjs'
import { BASE_WIDTH } from './materials.mjs'
import { show } from './sim.mjs'

/** @typedef {import('./create.mjs').AnimState} AnimState */

/**
 * 底座 → 柱 → 体，生长为完整图标。
 * @param {AnimState} [state] 动画状态
 * @returns {Generator<string, void, unknown>} 入场帧
 */
export function* enter(state = createAnimState()) {
	for (let n = 0; n <= BASE_WIDTH; n++) {
		state.baseBot = state.baseTop = n
		yield* show(state, { softBase: n < BASE_WIDTH })
	}
	for (let g = 1; g <= maxPillarH; g++) {
		state.pillars = g
		yield* show(state, { softPillars: g < maxPillarH })
		if (g < maxPillarH)
			yield* show(state, { softPillars: false })
	}
	state.pillars = maxPillarH
	yield* show(state)
	for (let reach = 0; reach <= maxBodyD; reach++) {
		state.bodyReach = reach
		state.bodyMinD = 0
		yield* show(state, { softBody: reach < maxBodyD })
	}
	state.bodyReach = maxBodyD
	yield* show(state)
}

/**
 * 在持续降雨下保持已长成的图标。
 * @param {AnimState} [state] 动画状态
 * @returns {Generator<string, void, unknown>} 保持帧
 */
export function* hold(state = createAnimState()) {
	state.baseBot = state.baseTop = BASE_WIDTH
	state.pillars = maxPillarH
	state.bodyReach = maxBodyD
	state.bodyMinD = 0
	for (; ;)
		yield* show(state)
}

/**
 * 拆解体 → 柱 → 底座；流体继续模拟。
 * @param {AnimState} [state] 动画状态
 * @returns {Generator<string, void, unknown>} 退场帧
 */
export function* exit(state = createAnimState()) {
	if (state.rainUntil === Infinity)
		state.rainUntil = Math.max(0, state.frame - 1)

	if (state.bodyReach >= 0) {
		const reach = state.bodyReach
		for (let gone = 0; gone <= reach + 1; gone++) {
			state.bodyMinD = gone
			yield* show(state, { softBody: gone <= reach })
		}
		state.bodyReach = -1
		state.bodyMinD = 0
	}

	if (state.pillars > 0) {
		const from = state.pillars
		for (let g = from; g >= 0; g--) {
			state.pillars = g
			if (g > 0) {
				yield* show(state, { softPillars: true })
				yield* show(state, { softPillars: false })
			}
			else
				yield* show(state)
		}
	}

	if (state.baseBot > 0 || state.baseTop > 0) {
		const from = Math.max(state.baseBot, state.baseTop)
		for (let n = from; n >= 1; n--) {
			state.baseBot = state.baseTop = n
			yield* show(state, { softBase: n < BASE_WIDTH })
		}
		state.baseBot = state.baseTop = 0
	}

	clearDynamics(state.world)
	const cells = state.width * state.height
	yield renderBuffers(Array(cells).fill(' '), Array(cells).fill(null), state.width, state.height)
}
