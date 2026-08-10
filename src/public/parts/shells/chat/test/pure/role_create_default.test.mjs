/**
 * role_create 应保留 @everyone / isDefault 标记。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { emptyMaterializedState } from '../../src/chat/dag/groupMaterializedState.mjs'
import { roleReducers } from '../../src/chat/dag/reducers/roles.mjs'

Deno.test('role_create keeps @everyone as default even if content omits isDefault', () => {
	const state = emptyMaterializedState()
	roleReducers.role_create(state, {
		content: {
			roleId: '@everyone',
			name: 'Everyone',
			color: '#99AAB5',
			position: 0,
			permissions: { SEND_MESSAGES: true },
		},
	})
	assertEquals(state.roles['@everyone'].isDefault, true)
})

Deno.test('role_create honors explicit isDefault on custom roles', () => {
	const state = emptyMaterializedState()
	roleReducers.role_create(state, {
		content: {
			roleId: 'member',
			name: 'Member',
			color: '#111',
			position: 1,
			permissions: {},
			isDefault: true,
		},
	})
	assertEquals(state.roles.member.isDefault, true)
})

Deno.test('role_create defaults custom roles to non-default', () => {
	const state = emptyMaterializedState()
	roleReducers.role_create(state, {
		content: {
			roleId: 'mod',
			name: 'Mod',
			color: '#222',
			position: 2,
			permissions: {},
		},
	})
	assertEquals(state.roles.mod.isDefault, false)
})
