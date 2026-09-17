/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { fallbackChannelId, firstOpenableChannelId } from '../../src/chat/lib/channelId.mjs'

/**
 * @param {Record<string, object>} channels 频道表
 * @param {object} [settings] groupSettings 覆盖
 * @returns {object} 物化状态片段
 */
function stateWith(channels, settings = {}) {
	return { channels, groupSettings: { rootChannelId: 'root', ...settings } }
}

Deno.test('firstOpenableChannelId returns null when no channel exists', () => {
	assertEquals(firstOpenableChannelId({ channels: {}, groupSettings: {} }), null)
	assertEquals(firstOpenableChannelId(stateWith({ root: { id: 'root', type: 'category', links: [] } })), null)
})

Deno.test('firstOpenableChannelId picks topmost openable channel in tree order', () => {
	const state = stateWith({
		root: { id: 'root', type: 'category', links: ['first', 'catA'] },
		first: { id: 'first', type: 'text', links: [] },
		catA: { id: 'catA', type: 'category', links: ['nested'] },
		nested: { id: 'nested', type: 'text', links: [] },
	})
	assertEquals(firstOpenableChannelId(state), 'first')
})

Deno.test('firstOpenableChannelId descends into leading category', () => {
	const state = stateWith({
		root: { id: 'root', type: 'category', links: ['emptyCat', 'catA'] },
		emptyCat: { id: 'emptyCat', type: 'category', links: [] },
		catA: { id: 'catA', type: 'category', links: ['nested'] },
		nested: { id: 'nested', type: 'text', links: [] },
	})
	assertEquals(firstOpenableChannelId(state), 'nested')
})

Deno.test('firstOpenableChannelId skips thread channels', () => {
	const state = stateWith({
		root: { id: 'root', type: 'category', links: ['thread1', 'real'] },
		thread1: { id: 'thread1', type: 'text', links: [], parentEventId: 'event-1' },
		real: { id: 'real', type: 'text', links: [] },
	})
	assertEquals(firstOpenableChannelId(state), 'real')
})

Deno.test('firstOpenableChannelId falls back to channel-table order without root', () => {
	const state = {
		channels: {
			a: { id: 'a', type: 'category', links: [] },
			b: { id: 'b', type: 'text', links: [] },
		},
		groupSettings: {},
	}
	assertEquals(firstOpenableChannelId(state), 'b')
})

Deno.test('fallbackChannelId prefers explicit default, then root, then first, else null', () => {
	const base = { channels: { root: { id: 'root', type: 'category' }, c1: { id: 'c1', type: 'text' } }, groupSettings: { rootChannelId: 'root' } }
	assertEquals(fallbackChannelId(base), 'root')
	assertEquals(fallbackChannelId({ ...base, groupSettings: { rootChannelId: 'root', defaultChannelId: 'c1' } }), 'c1')
	assertEquals(fallbackChannelId({ channels: {}, groupSettings: {} }), null)
})
