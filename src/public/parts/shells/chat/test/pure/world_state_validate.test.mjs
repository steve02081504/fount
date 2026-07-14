/**
 * world_state content 形状校验。
 */
/* global Deno */
import { assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { validateWorldStateContent } from '../../src/chat/dag/worldStateEventValidate.mjs'

Deno.test('world_state: set 缺 value 抛错', () => {
	assertThrows(
		() => validateWorldStateContent({
			type: 'world_state',
			content: { worldname: 'w', action: 'set', key: 'k' },
		}),
		Error,
		'value required',
	)
})

Deno.test('world_state: delete 可无 value', () => {
	validateWorldStateContent({
		type: 'world_state',
		content: { worldname: 'w', action: 'delete', key: 'k' },
	})
})

Deno.test('world_state: 非法 action 抛错', () => {
	assertThrows(
		() => validateWorldStateContent({
			type: 'world_state',
			content: { worldname: 'w', action: 'incr', key: 'k', value: 1 },
		}),
		Error,
		'action must be set or delete',
	)
})
