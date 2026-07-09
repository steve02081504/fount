/**
 * M8：world_op LWW reducer 纯测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { emptyMaterializedState } from '../../src/chat/dag/groupMaterializedState.mjs'
import { worldOpReducers } from '../../src/chat/dag/reducers/worldOps.mjs'

const WORLD = 'rpg_world'

/**
 * @param {object} state 物化状态
 * @param {string} op set|del
 * @param {string} key 键
 * @param {unknown} [value] set 值
 * @param {{ wall: number, logical: number }} hlc HLC
 * @returns {object} 更新后 state
 */
function applyOp(state, op, key, value, hlc) {
	return worldOpReducers.world_op(state, {
		type: 'world_op',
		groupId: 'g1',
		hlc,
		content: { worldname: WORLD, op, key, value },
	})
}

Deno.test('world_op: set 写入并可 entries 读出', () => {
	let state = emptyMaterializedState()
	state = applyOp(state, 'set', 'weather', 'sunny', { wall: 1, logical: 0 })
	assertEquals(state.worldStates[WORLD].weather.value, 'sunny')
})

Deno.test('world_op: 较晚 HLC 覆盖较早 set', () => {
	let state = emptyMaterializedState()
	state = applyOp(state, 'set', 'stage', 1, { wall: 1, logical: 0 })
	state = applyOp(state, 'set', 'stage', 2, { wall: 2, logical: 0 })
	assertEquals(state.worldStates[WORLD].stage.value, 2)
})

Deno.test('world_op: 乱序重放收敛到最大 HLC', () => {
	let state = emptyMaterializedState()
	state = applyOp(state, 'set', 'score', 100, { wall: 3, logical: 0 })
	state = applyOp(state, 'set', 'score', 50, { wall: 1, logical: 0 })
	state = applyOp(state, 'set', 'score', 75, { wall: 2, logical: 0 })
	assertEquals(state.worldStates[WORLD].score.value, 100)
})

Deno.test('world_op: del 墓碑后 value 为 deleted', () => {
	let state = emptyMaterializedState()
	state = applyOp(state, 'set', 'flag', true, { wall: 1, logical: 0 })
	state = applyOp(state, 'del', 'flag', undefined, { wall: 2, logical: 0 })
	assertEquals(state.worldStates[WORLD].flag.deleted, true)
	assertEquals(state.worldStates[WORLD].flag.value, undefined)
})

Deno.test('world_op: 较晚 del 胜较早 set', () => {
	let state = emptyMaterializedState()
	state = applyOp(state, 'set', 'x', 1, { wall: 5, logical: 0 })
	state = applyOp(state, 'del', 'x', undefined, { wall: 5, logical: 1 })
	assertEquals(state.worldStates[WORLD].x.deleted, true)
})
