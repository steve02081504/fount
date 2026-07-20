/**
 * GetChatPlugins merge 优先级（本机同名优先）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

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
