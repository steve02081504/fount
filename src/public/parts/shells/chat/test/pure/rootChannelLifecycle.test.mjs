/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { assertThrows } from 'jsr:@std/assert'

import { emptyMaterializedState } from '../../src/chat/dag/groupMaterializedState.mjs'
import { ROOT_CHANNEL_ID, assertNotRootChannel } from '../../src/chat/dag/groupSettings.mjs'
import { channelReducers } from '../../src/chat/dag/reducers/channels.mjs'
import { governanceReducers } from '../../src/chat/dag/reducers/governance.mjs'

Deno.test('assertNotRootChannel rejects root, allows normal channels', () => {
	assertThrows(() => assertNotRootChannel(ROOT_CHANNEL_ID, 'message'), /root channel/i)
	assertThrows(() => assertNotRootChannel('root', 'upload file'), /root channel/i)
	// 普通频道不应被拦截。
	assertNotRootChannel('default')
	assertNotRootChannel('channel_abc')
})

Deno.test('materializeGroupSettings defaults rootChannelId to null', () => {
	const state = emptyMaterializedState()
	assertEquals(state.groupSettings.rootChannelId, null)
})

Deno.test('genesis sequence: root channel owns default channel, settings record rootChannelId', () => {
	let state = emptyMaterializedState()
	state = channelReducers.channel_create(state, {
		timestamp: 1,
		content: { channelId: ROOT_CHANNEL_ID, type: 'category', name: '', links: ['default'], permBlockId: null },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: {
			channelId: 'default',
			type: 'text',
			name: 'general',
			links: [],
			parentChannelId: ROOT_CHANNEL_ID,
			permBlockId: ROOT_CHANNEL_ID,
		},
	})
	state = governanceReducers.group_settings_update(state, {
		content: { defaultChannelId: 'default', rootChannelId: ROOT_CHANNEL_ID },
	})

	assertEquals(state.channels[ROOT_CHANNEL_ID]?.type, 'category')
	assertEquals(state.channels[ROOT_CHANNEL_ID]?.links, ['default'])
	assertEquals(state.channels['default']?.permBlockId, ROOT_CHANNEL_ID)
	assertEquals(state.groupSettings.rootChannelId, ROOT_CHANNEL_ID)
	assertEquals(state.groupSettings.defaultChannelId, 'default')
})

Deno.test('new root-level channel appends to root links; explicit permBlockId keeps root permission block', () => {
	let state = emptyMaterializedState()
	state = channelReducers.channel_create(state, {
		timestamp: 1,
		content: { channelId: ROOT_CHANNEL_ID, type: 'category', name: '', links: ['default'], permBlockId: null },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: {
			channelId: 'catA',
			type: 'category',
			name: '媒体',
			links: [],
			parentChannelId: ROOT_CHANNEL_ID,
			permBlockId: ROOT_CHANNEL_ID,
		},
	})
	assertEquals(state.channels[ROOT_CHANNEL_ID]?.links, ['default', 'catA'])
	assertEquals(state.channels['catA']?.permBlockId, ROOT_CHANNEL_ID)
})

Deno.test('channel_delete of root is not applied by reducer (guard against wiping whole tree)', () => {
	let state = emptyMaterializedState()
	state = channelReducers.channel_create(state, {
		timestamp: 1,
		content: { channelId: ROOT_CHANNEL_ID, type: 'category', name: '', links: ['default'], permBlockId: null },
	})
	state = channelReducers.channel_create(state, {
		timestamp: 2,
		content: {
			channelId: 'default',
			type: 'text',
			name: 'general',
			links: [],
			parentChannelId: ROOT_CHANNEL_ID,
			permBlockId: ROOT_CHANNEL_ID,
		},
	})
	state = governanceReducers.group_settings_update(state, {
		content: { rootChannelId: ROOT_CHANNEL_ID },
	})
	const stateBefore = structuredClone(state)
	state = channelReducers.channel_delete(state, { content: { channelId: ROOT_CHANNEL_ID } })
	// 保护：删除根容器时不应级联清空（联邦恶意/误删防御），reducer 应为完全无操作。
	assertEquals(state, stateBefore)
})
