/**
 * M8：world_state LWW reducer 纯测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { emptyMaterializedState } from '../../src/chat/dag/groupMaterializedState.mjs'
import { worldStateReducers } from '../../src/chat/dag/reducers/worldState.mjs'

const WORLD = 'rpg_world'

/**
 * @param {object} state 物化状态
 * @param {'set' | 'delete'} action 写入动作
 * @param {string} key 键
 * @param {unknown} [value] set 值
 * @param {{ wall: number, logical: number }} hlc HLC
 * @returns {object} 更新后 state
 */
function applyStateWrite(state, action, key, value, hlc) {
	return worldStateReducers.world_state(state, {
		type: 'world_state',
		groupId: 'g1',
		hlc,
		content: { worldname: WORLD, action, key, value },
	})
}

Deno.test('world_state: set 写入并可 entries 读出', () => {
	let state = emptyMaterializedState()
	state = applyStateWrite(state, 'set', 'weather', 'sunny', { wall: 1, logical: 0 })
	assertEquals(state.worldStates[WORLD].weather.value, 'sunny')
})

Deno.test('world_state: 较晚 HLC 覆盖较早 set', () => {
	let state = emptyMaterializedState()
	state = applyStateWrite(state, 'set', 'stage', 1, { wall: 1, logical: 0 })
	state = applyStateWrite(state, 'set', 'stage', 2, { wall: 2, logical: 0 })
	assertEquals(state.worldStates[WORLD].stage.value, 2)
})

Deno.test('world_state: 乱序重放收敛到最大 HLC', () => {
	let state = emptyMaterializedState()
	state = applyStateWrite(state, 'set', 'score', 100, { wall: 3, logical: 0 })
	state = applyStateWrite(state, 'set', 'score', 50, { wall: 1, logical: 0 })
	state = applyStateWrite(state, 'set', 'score', 75, { wall: 2, logical: 0 })
	assertEquals(state.worldStates[WORLD].score.value, 100)
})

Deno.test('world_state: delete 墓碑后 value 为 deleted', () => {
	let state = emptyMaterializedState()
	state = applyStateWrite(state, 'set', 'flag', true, { wall: 1, logical: 0 })
	state = applyStateWrite(state, 'delete', 'flag', undefined, { wall: 2, logical: 0 })
	assertEquals(state.worldStates[WORLD].flag.deleted, true)
	assertEquals(state.worldStates[WORLD].flag.value, undefined)
})

Deno.test('world_state: 较晚 delete 胜较早 set', () => {
	let state = emptyMaterializedState()
	state = applyStateWrite(state, 'set', 'x', 1, { wall: 5, logical: 0 })
	state = applyStateWrite(state, 'delete', 'x', undefined, { wall: 5, logical: 1 })
	assertEquals(state.worldStates[WORLD].x.deleted, true)
})
