/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { awakeNow, checkForSleep, onSystemWake, setAwakeTimeout } from '../../sleep_watch.mjs'

Deno.test('sleep watcher extends running deadlines and notifies active work once', async () => {
	const originalNow = Date.now
	let now = originalNow()
	/**
	 * 返回测试的模拟时间。
	 * @returns {number} 当前模拟时间。
	 */
	Date.now = () => now
	const sleeps = []
	const unsubscribe = onSystemWake(duration => sleeps.push(duration))
	let timedOut = false
	const cancel = setAwakeTimeout(() => { timedOut = true }, 30)
	try {
		const before = awakeNow()
		now += 6 * 60 * 1000
		checkForSleep(now)
		assertEquals(sleeps.length, 1)
		assertEquals(sleeps[0], 6 * 60 * 1000 - 1000)
		assertEquals(awakeNow() - before, 1000)
		await new Promise(resolve => setTimeout(resolve, 10))
		assert(!timedOut, '休眠期间不应耗尽剩余预算')
		now += 40
		await new Promise(resolve => setTimeout(resolve, 40))
		assert(timedOut, '恢复运行后才会超时')
	}
	finally {
		cancel()
		unsubscribe()
		Date.now = originalNow
		checkForSleep()
	}
})
