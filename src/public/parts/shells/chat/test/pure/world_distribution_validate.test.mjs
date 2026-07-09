/**
 * M7：session_world_bind* 的 distribution / homeNodeHash 校验。
 */
/* global Deno */
import { assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { validateSessionEventContent } from '../../src/chat/dag/sessionEventValidate.mjs'

const BASE = {
	worldname: 'test_world',
	ownerUsername: 'alice',
}

Deno.test('session_world_bind: hosted 缺 homeNodeHash 抛错', () => {
	assertThrows(
		() => validateSessionEventContent({
			type: 'session_world_bind',
			content: { ...BASE, distribution: 'hosted' },
		}),
		Error,
		'homeNodeHash required',
	)
})

Deno.test('session_world_bind: 缺 distribution 视同 hosted，缺 homeNodeHash 抛错', () => {
	assertThrows(
		() => validateSessionEventContent({
			type: 'session_world_bind',
			content: { ...BASE },
		}),
		Error,
		'homeNodeHash required',
	)
})

Deno.test('session_world_bind: replicated 缺 homeNodeHash 抛错', () => {
	assertThrows(
		() => validateSessionEventContent({
			type: 'session_world_bind',
			content: { ...BASE, distribution: 'replicated' },
		}),
		Error,
		'homeNodeHash required',
	)
})

Deno.test('session_world_bind: local 缺 homeNodeHash 通过', () => {
	validateSessionEventContent({
		type: 'session_world_bind',
		content: { ...BASE, distribution: 'local' },
	})
})

Deno.test('session_world_bind: hosted 带 homeNodeHash 通过', () => {
	validateSessionEventContent({
		type: 'session_world_bind',
		content: { ...BASE, distribution: 'hosted', homeNodeHash: 'a'.repeat(64) },
	})
})

Deno.test('session_world_bind: 非法 distribution 抛错', () => {
	assertThrows(
		() => validateSessionEventContent({
			type: 'session_world_bind',
			content: { ...BASE, distribution: 'magic', homeNodeHash: 'a'.repeat(64) },
		}),
		Error,
		'invalid distribution',
	)
})

Deno.test('session_world_bind_channel: local 缺 homeNodeHash 通过', () => {
	validateSessionEventContent({
		type: 'session_world_bind_channel',
		content: { ...BASE, channelId: 'default', distribution: 'local' },
	})
})

Deno.test('session_world_bind_channel: hosted 缺 homeNodeHash 抛错', () => {
	assertThrows(
		() => validateSessionEventContent({
			type: 'session_world_bind_channel',
			content: { ...BASE, channelId: 'default', distribution: 'hosted' },
		}),
		Error,
		'homeNodeHash required',
	)
})
