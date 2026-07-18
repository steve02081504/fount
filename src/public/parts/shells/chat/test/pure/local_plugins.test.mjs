/**
 * 遗留 session_plugin_* no-op + GetChatPlugins merge 优先级。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { applyEvent, emptyMaterializedState } from '../../src/chat/dag/groupMaterializedState.mjs'

Deno.test('session_plugin_* 遗留事件 no-op（不写 session.plugins）', () => {
	const state = emptyMaterializedState()
	applyEvent(state, {
		type: 'session_plugin_add',
		content: { ownerUsername: 'u1', pluginname: 'x' },
	})
	assertEquals(state.session?.plugins, undefined)
	applyEvent(state, {
		type: 'session_plugin_remove',
		content: { ownerUsername: 'u1', pluginname: 'x' },
	})
	assertEquals(state.session?.plugins, undefined)
})

Deno.test('GetChatPlugins merge：本机同名优先', () => {
	const worldPlugin = { info: { name: 'shared' }, tag: 'world' }
	const localPlugin = { info: { name: 'shared' }, tag: 'local' }
	const onlyWorld = { info: { name: 'world-only' }, tag: 'world' }
	// 与 getChatRequest 一致：{ ...worldPlugins, ...localPlugins } 后注入内建
	const merged = {
		...{ shared: worldPlugin, 'world-only': onlyWorld },
		...{ shared: localPlugin },
		fount_chat: { info: { name: 'fount_chat' } },
	}
	assertEquals(merged.shared.tag, 'local')
	assertEquals(merged['world-only'].tag, 'world')
	assertEquals(merged.fount_chat.info.name, 'fount_chat')
})
