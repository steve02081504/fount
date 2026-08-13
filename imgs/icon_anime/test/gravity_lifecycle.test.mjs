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
	startGravity({
		/**
		 * 挂起采集加载，便于 stop 抢先。
		 * @returns {Promise<{ start: () => () => void }>} 假采集模块
		 */
		loadAcquire: () => pending,
	})
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
		/**
		 * 假采集：start 内立刻 stopGravity。
		 * @returns {Promise<{ start: () => () => void }>} 假采集模块
		 */
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

Deno.test('gravity: abort stop reentering startGravity keeps the new controller', async () => {
	let phase = 0
	let live = 0
	startGravity({
		/**
		 * 假采集：abort 同步路径重入 startGravity。
		 * @returns {Promise<{ start: () => () => void }>} 假采集模块
		 */
		loadAcquire: async () => ({
			/**
			 * 第一轮：abort 同步路径重入 startGravity；第二轮正常开采。
			 * @returns {() => void} stop
			 */
			start: () => {
				live++
				if (phase++ === 0) {
					startGravity({
						/**
						 * 第二轮假采集加载。
						 * @returns {Promise<{ start: () => () => void }>} 假采集模块
						 */
						loadAcquire: async () => ({
							/**
							 * 第二轮假 start。
							 * @returns {() => void} stop
							 */
							start: () => {
								live++
								return () => { live-- }
							},
						}),
					})
					return () => { live-- }
				}
				return () => { live-- }
			},
		}),
	})
	await Promise.resolve()
	await Promise.resolve()
	await Promise.resolve()
	assertEquals(live, 1)
	stopGravity()
	assertEquals(live, 0)
})
