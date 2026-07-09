import { HLC } from '../../../../../../../../scripts/p2p/hlc.mjs'

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
export const worldOpReducers = {
	/**
	 * 处理 `world_op` 事件：按 HLC 全序 LWW 折叠到 `state.worldStates[worldname]`。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	world_op(state, event) {
		withGroupId(state, event)
		const content = event.content || {}
		const worldname = String(content.worldname || '').trim()
		const key = String(content.key || '').trim()
		const op = String(content.op || '').trim()
		if (!worldname || !key || !op) return state

		const bucket = ensureWorldStateBucket(state, worldname)
		const existing = bucket[key]
		const hlc = event.hlc
		if (!hlc || compareHlcJson(hlc, existing?.hlc) < 0) return state

		if (op === 'del')
			bucket[key] = { deleted: true, hlc }
		else if (op === 'set')
			bucket[key] = { value: content.value, hlc }

		return state
	},
}
