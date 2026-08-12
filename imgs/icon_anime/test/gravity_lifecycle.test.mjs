/**
 * gravity 启停生命周期：异步 load 与 stop 交错不得留下孤儿采集。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { startGravity, stopGravity } from '../gravity.mjs'

Deno.test('gravity: stop before acquire resolves never starts sensors', async () => {
	let started = 0
	/** @type {(mod: { start: () => () => void }) => void} */
	let resolveLoader
	const pending = new Promise(resolve => { resolveLoader = resolve })
	startGravity({ loadAcquire: () => pending })
	stopGravity()
	resolveLoader({
		/**
		 * 假 start：计数开采。
		 * @returns {() => void} stop
		 */
		start: () => {
			started++
			return () => { /* noop */ }
		},
	})
	await pending
	await Promise.resolve()
	assertEquals(started, 0)
})

Deno.test('gravity: stop during sync start() still releases', async () => {
	let live = 0
	startGravity({
		loadAcquire: async () => ({
			/**
			 * 假 start：开采后立刻 stopGravity。
			 * @returns {() => void} stop
			 */
			start: () => {
				live++
				stopGravity()
				return () => { live-- }
			},
		}),
	})
	await Promise.resolve()
	await Promise.resolve()
	assertEquals(live, 0)
})
