/**
 * CLI 同优先级 LIFO / FS LIFO / 预备 debounce / viewer 移除 / CLI 完成剔 FS。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { TestQueues } from '../kernel/queues.mjs'

/**
 * 可变测试时钟。
 * @param {number} [start] 起始毫秒
 * @returns {{ now: () => number, set: (value: number) => void }} 时钟
 */
function mutableClock(start = 0) {
	let current = start
	return {
		/**
		 * 当前模拟时间（毫秒）。
		 * @returns {number} 当前毫秒
		 */
		now: () => current,
		/**
		 * 将模拟时间设为指定值。
		 * @param {number} value 新毫秒
		 * @returns {void}
		 */
		set: value => { current = value },
	}
}

Deno.test('CLI queue is LIFO among equal priority', () => {
	const queues = new TestQueues()
	queues.enqueueCli({ key: 'earlier', viewerId: 'viewer' })
	queues.enqueueCli({ key: 'later', viewerId: 'viewer' })
	const first = queues.peekReady(() => true)
	assertEquals(first?.item.key, 'later')
	queues.dequeue(first)
	assertEquals(queues.peekReady(() => true)?.item.key, 'earlier')
})

Deno.test('CLI imperfect priority still beats a later normal item', () => {
	const queues = new TestQueues()
	queues.enqueueCli({ key: 'old', viewerId: 'viewer', priority: 1 })
	queues.enqueueCli({ key: 'imperfect', viewerId: 'viewer', priority: 0 })
	queues.enqueueCli({ key: 'newer', viewerId: 'viewer', priority: 1 })
	assertEquals(queues.peekReady(() => true)?.item.key, 'imperfect')
})

Deno.test('FS fills when no CLI item is ready', () => {
	const queues = new TestQueues()
	queues.enqueueCli({ key: 'blocked', viewerId: 'v' })
	queues.fs.unshift({
		id: 'f1',
		key: 'hot',
		source: 'fs',
		enqueuedAt: 0,
	})
	assertEquals(queues.peekReady(item => item.key === 'hot')?.item.key, 'hot')
})

Deno.test('FS queue is LIFO and CLI is preferred', () => {
	const clock = mutableClock()
	const queues = new TestQueues({ prepSettleMs: 10, now: clock.now })
	queues.hitPrep('old')
	clock.set(10)
	queues.promotePrep()
	queues.hitPrep('new')
	clock.set(20)
	queues.promotePrep()
	assertEquals(queues.fs.map(item => item.key), ['new', 'old'])
	assertEquals(queues.peekReady(() => true)?.item.key, 'new')

	queues.enqueueCli({ key: 'cli', viewerId: 'v' })
	assertEquals(queues.peekReady(() => true)?.item.key, 'cli')
})

Deno.test('CLI and FS duplicates are kept until CLI completes', () => {
	const clock = mutableClock()
	const queues = new TestQueues({ prepSettleMs: 1, now: clock.now })
	queues.enqueueCli({ key: 'same', viewerId: 'v' })
	queues.hitPrep('same')
	clock.set(1)
	queues.promotePrep()
	assertEquals(queues.cli.length, 1)
	assertEquals(queues.fs.length, 1)
	const removed = queues.completeCli('same')
	assertEquals(removed.length, 1)
	assertEquals(queues.fs.length, 0)
})

Deno.test('viewer disconnect removes its CLI items only', () => {
	const queues = new TestQueues()
	queues.enqueueCli({ key: 'a', viewerId: 'v1' })
	queues.enqueueCli({ key: 'b', viewerId: 'v2' })
	queues.enqueueCli({ key: 'a', viewerId: 'v2' })
	const removed = queues.removeViewer('v2')
	assertEquals(removed.map(item => item.key), ['b', 'a'])
	assertEquals(queues.cli.map(item => item.key), ['a'])
})

Deno.test('prep hit resets settle and pulls back from FS', () => {
	const clock = mutableClock()
	const queues = new TestQueues({ prepSettleMs: 10, now: clock.now })
	queues.hitPrep('x')
	clock.set(10)
	queues.promotePrep()
	assertEquals(queues.fs.length, 1)
	queues.hitPrep('x')
	assertEquals(queues.fs.length, 0)
	assertEquals(queues.prep.has('x'), true)
	clock.set(15)
	queues.promotePrep()
	assertEquals(queues.fs.length, 0)
	clock.set(20)
	queues.promotePrep()
	assertEquals(queues.fs[0].key, 'x')
})

Deno.test('removeKey drops prep and both queues', () => {
	const clock = mutableClock()
	const queues = new TestQueues({ prepSettleMs: 1, now: clock.now })
	queues.enqueueCli({ key: 'gone', viewerId: 'v' })
	queues.hitPrep('gone')
	clock.set(1)
	queues.promotePrep()
	const removed = queues.removeKey('gone')
	assertEquals(removed.length, 2)
	assertEquals(queues.allEmpty(), true)
})
