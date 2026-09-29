/**
 * 群写锁可重入 / 脱离上下文语义：
 * fire-and-forget 任务继承的持有标记在父锁退出后必须失效，避免绕过互斥锁并发写 DAG。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import {
	isGroupWriteLockLeaked,
	runOutsideGroupLocks,
	withGroupWriteLock,
} from '../../src/chat/dag/groupLock.mjs'

Deno.test('runOutsideGroupLocks clears the inherited lock marker', async () => {
	let leakedDuringExit
	await withGroupWriteLock('u', 'g', async () => {
		leakedDuringExit = runOutsideGroupLocks(() => isGroupWriteLockLeaked('u', 'g'))
	})
	assertEquals(leakedDuringExit, false)
})

Deno.test('isGroupWriteLockLeaked detects a context outliving the critical section', async () => {
	let leakedFlag
	/** @type {() => void} */
	let release
	const gate = new Promise(resolve => { release = resolve })
	let detached
	await withGroupWriteLock('u', 'g', async () => {
		detached = (async () => {
			await gate
			leakedFlag = isGroupWriteLockLeaked('u', 'g')
		})()
	})
	release()
	await detached
	assertEquals(leakedFlag, true)
})

Deno.test('runOutsideGroupLocks runs fn without the lock; a nested withGroupWriteLock still takes the mutex', async () => {
	const order = []
	/** @type {() => void} */
	let releaseHolder
	let detached
	/** @type {() => void} */
	let releaseGate
	const gate = new Promise(resolve => { releaseGate = resolve })

	await withGroupWriteLock('u', 'g', async () => {
		order.push('outer-start')
		detached = runOutsideGroupLocks(() => withGroupWriteLock('u', 'g', async () => {
			order.push('inner-start')
		}))
		// 若内层继承了可重入标记，会立刻执行；正确的脱离上下文应排队等待外层释放。
		await new Promise(resolve => setTimeout(resolve, 10))
		order.push('outer-end')
	})
	await detached
	assertEquals(order, ['outer-start', 'outer-end', 'inner-start'])

	// 独立复测：内层必须等另一个新上下文释放后才能进入临界区。
	const order2 = []
	let stalled
	await withGroupWriteLock('u2', 'g2', async () => {
		stalled = runOutsideGroupLocks(() => (async () => {
			await gate
			await withGroupWriteLock('u2', 'g2', async () => { order2.push('stalled') })
		})())
	})
	const holder = withGroupWriteLock('u2', 'g2', async () => {
		order2.push('holder-start')
		await new Promise(resolve => { releaseHolder = resolve })
		order2.push('holder-end')
	})
	releaseGate()
	await new Promise(resolve => setTimeout(resolve, 10))
	releaseHolder()
	await holder
	await stalled
	assertEquals(order2.indexOf('stalled') > order2.indexOf('holder-end'), true)
})
