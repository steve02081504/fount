/**
 * memoizePromise 缓存命中须仍返回 Promise（Hub presence `.catch` 依赖）。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { memoizePromise } from '../../../../../pages/scripts/lib/memo.mjs'

Deno.test('memoizePromise cache hit returns a Promise with .catch', async () => {
	let calls = 0
	const load = memoizePromise(
		key => key,
		async key => {
			calls += 1
			return { key }
		},
		{ max: 8 },
	)

	assertEquals(await load('a'), { key: 'a' })
	assertEquals(calls, 1)

	const second = load('a')
	assert(typeof second.then === 'function', 'cache hit must be thenable')
	assert(typeof second.catch === 'function', 'cache hit must expose .catch')
	assertEquals(await second.catch(() => null), { key: 'a' })
	assertEquals(calls, 1)
})
