/**
 * M8：world_op content 形状校验。
 */
/* global Deno */
import { assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { validateWorldOpContent } from '../../src/chat/dag/worldOpEventValidate.mjs'

Deno.test('world_op: set 缺 value 抛错', () => {
	assertThrows(
		() => validateWorldOpContent({
			type: 'world_op',
			content: { worldname: 'w', op: 'set', key: 'k' },
		}),
		Error,
		'value required',
	)
})

Deno.test('world_op: del 可无 value', () => {
	validateWorldOpContent({
		type: 'world_op',
		content: { worldname: 'w', op: 'del', key: 'k' },
	})
})

Deno.test('world_op: 非法 op 抛错', () => {
	assertThrows(
		() => validateWorldOpContent({
			type: 'world_op',
			content: { worldname: 'w', op: 'incr', key: 'k', value: 1 },
		}),
		Error,
		'op must be set or del',
	)
})
