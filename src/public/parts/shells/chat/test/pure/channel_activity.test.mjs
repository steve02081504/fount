/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	aggregateChannelActivity,
	selectOtherCharNames,
	topActiveKeys,
} from '../../src/chat/session/channelActivity.mjs'

Deno.test('aggregateChannelActivity splits char and human senders', () => {
	const { chars, humans } = aggregateChannelActivity([
		{ charId: 'alice', hlc: { wall: 100 }, sender: 'aa' },
		{ charId: 'bob', timestamp: 200, sender: 'bb' },
		{ charId: 'alice', time_stamp: 150, sender: 'aa' },
		{ sender: 'CcCc', hlc: { wall: 300 } },
		{ sender: 'cccc', timestamp: 250 },
	])
	assertEquals(chars.alice, { last_active: 150, count: 2 })
	assertEquals(chars.bob, { last_active: 200, count: 1 })
	assertEquals(humans.cccc, { last_active: 300, count: 2 })
})

Deno.test('selectOtherCharNames keeps permanent and active Top-N', () => {
	const names = selectOtherCharNames(
		['a', 'b', 'c', 'd', 'me'],
		'me',
		{ a: 1, b: 0, c: 0, d: 0 },
		{
			b: { last_active: 10, count: 1 },
			c: { last_active: 30, count: 1 },
			d: { last_active: 20, count: 5 },
		},
		2,
	)
	assertEquals(new Set(names), new Set(['a', 'c', 'd']))
})

Deno.test('topActiveKeys ranks by last_active then count', () => {
	assertEquals(topActiveKeys({
		x: { last_active: 1, count: 9 },
		y: { last_active: 5, count: 1 },
		z: { last_active: 5, count: 3 },
	}, 2), ['z', 'y'])
})
