/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createDeferredFinish } from '../../src/finish_scheduler.mjs'

/**
 * 构造收集载荷的 onRun 回调。
 * @param {object[]} runs - 收集到的载荷。
 * @returns {(payload: any) => void} onRun 回调。
 */
function collector(runs) {
	return payload => runs.push(payload)
}

/**
 * 构造可手动推进的假计时器。
 * @returns {{setTimer: Function, clearTimer: Function, advance: Function, pending: () => number}} 假计时器工具。
 */
function fakeTimers() {
	let nextId = 1
	const timers = new Map()
	return {
		/**
		 * 登记一个假计时器。
		 * @param {Function} fn - 到期回调。
		 * @returns {number} 计时器 id。
		 */
		setTimer: fn => {
			const id = nextId++
			timers.set(id, fn)
			return id
		},
		/**
		 * 取消一个假计时器。
		 * @param {number} id - 计时器 id。
		 * @returns {void}
		 */
		clearTimer: id => { timers.delete(id) },
		/**
		 * 触发全部待运行计时器。
		 * @returns {void}
		 */
		advance: () => {
			const snapshot = [...timers.entries()]
			timers.clear()
			for (const [, fn] of snapshot) fn()
		},
		/** @returns {number} 待运行计时器数。 */
		pending: () => timers.size,
	}
}

Deno.test('deferred finish runs the payload after the delay', () => {
	const timers = fakeTimers()
	const runs = []
	const scheduler = createDeferredFinish({ delayMs: 13_000, onRun: collector(runs), ...timers })
	scheduler.schedule('k', { id: 1 })
	assertEquals(timers.pending(), 1)
	// 未到期不运行
	assertEquals(runs, [])
	timers.advance()
	assertEquals(runs, [{ id: 1 }])
	assertEquals(timers.pending(), 0)
})

Deno.test('touch resets the timer; cancel drops the run', () => {
	const timers = fakeTimers()
	const runs = []
	const scheduler = createDeferredFinish({ delayMs: 13_000, onRun: collector(runs), ...timers })
	scheduler.schedule('k', { id: 1 })
	// touch 重置：旧的到期回调已被清理，advance 后仍不运行
	assertEquals(scheduler.touch('k'), true)
	assertEquals(timers.pending(), 1)
	timers.advance()
	assertEquals(runs, [{ id: 1 }])
	// cancel 后不再运行
	scheduler.schedule('k', { id: 2 })
	assertEquals(scheduler.cancel('k'), { id: 2 })
	assertEquals(timers.pending(), 0)
	timers.advance()
	assertEquals(runs, [{ id: 1 }])
	// 未知键的 touch/cancel 为无操作
	assertEquals(scheduler.touch('missing'), false)
	assertEquals(scheduler.cancel('missing'), null)
})

Deno.test('rescheduling the same key replaces the payload', () => {
	const timers = fakeTimers()
	const runs = []
	const scheduler = createDeferredFinish({ delayMs: 13_000, onRun: collector(runs), ...timers })
	scheduler.schedule('k', { id: 1 })
	const replaced = scheduler.schedule('k', { id: 2 })
	assertEquals(replaced, { id: 1 })
	assertEquals(timers.pending(), 1)
	timers.advance()
	assertEquals(runs, [{ id: 2 }])
})
