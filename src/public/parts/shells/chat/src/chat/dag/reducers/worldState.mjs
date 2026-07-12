import { HLC } from 'npm:@steve02081504/fount-p2p/core/hlc'

import { withGroupId } from './helpers.mjs'

/**
 * @param {{ wall: number, logical: number } | null | undefined} a 候选 HLC
 * @param {{ wall: number, logical: number } | null | undefined} b 已存 HLC
 * @returns {number} 与 HLC.compare 同号
 */
function compareHlcJson(a, b) {
	if (!a) return b ? -1 : 0
	if (!b) return 1
	return HLC.fromJSON(a).compare(HLC.fromJSON(b))
}

/**
 * @param {object} state 物化群状态
 * @param {string} worldname 世界名
 * @returns {Record<string, { value?: unknown, deleted?: boolean, hlc: object }>} key → LWW 槽
 */
function ensureWorldStateBucket(state, worldname) {
	if (!state.worldStates) state.worldStates = {}
	if (!state.worldStates[worldname]) state.worldStates[worldname] = {}
	return state.worldStates[worldname]
}

/** @type {Record<string, (state: object, event: object) => object>} */
export const worldStateReducers = {
	/**
	 * 处理 `world_state` 事件：按 HLC 全序 LWW 折叠到 `state.worldStates[worldname]`。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	world_state(state, event) {
		withGroupId(state, event)
		const { worldname, action, key, value } = event.content
		if (!worldname?.trim() || !key?.trim() || !action) return state

		const bucket = ensureWorldStateBucket(state, worldname.trim())
		const existing = bucket[key.trim()]
		const hlc = event.hlc
		if (!hlc || compareHlcJson(hlc, existing?.hlc) < 0) return state

		if (action === 'delete')
			bucket[key.trim()] = { deleted: true, hlc }
		else if (action === 'set')
			bucket[key.trim()] = { value, hlc }

		return state
	},
}
