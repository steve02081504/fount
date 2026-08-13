/**
 * CLI FIFO / FS LIFO / 预备 debounce / viewer 移除 / CLI 完成剔 FS。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { TestQueues } from '../kernel/queues.mjs'

Deno.test('CLI queue is FIFO', () => {
	const q = new TestQueues()
	q.enqueueCli({ key: 'a', viewerId: 'v1' })
	q.enqueueCli({ key: 'b', viewerId: 'v1' })
	const first = q.peekReady(() => true)
	assertEquals(first?.item.key, 'a')
	q.dequeue(first)
	assertEquals(q.peekReady(() => true)?.item.key, 'b')
})

Deno.test('FS fills when no CLI item is ready', () => {
	const q = new TestQueues()
	q.enqueueCli({ key: 'blocked', viewerId: 'v' })
	q.fs.unshift({
		id: 'f1',
		key: 'hot',
		source: 'fs',
		enqueuedAt: 0,
	})
	assertEquals(q.peekReady(item => item.key === 'hot')?.item.key, 'hot')
})

Deno.test('FS queue is LIFO and CLI is preferred', () => {
	let t = 0
	/**
	 * @returns {number} 测试时钟
	 */
	const now = () => t
	const q = new TestQueues({ prepSettleMs: 10, now })
	q.hitPrep('old')
	t = 10
	q.promotePrep()
	q.hitPrep('new')
	t = 20
	q.promotePrep()
	assertEquals(q.fs.map(item => item.key), ['new', 'old'])
	assertEquals(q.peekReady(() => true)?.item.key, 'new')

	q.enqueueCli({ key: 'cli', viewerId: 'v' })
	assertEquals(q.peekReady(() => true)?.item.key, 'cli')
})

Deno.test('CLI and FS duplicates are kept until CLI completes', () => {
	let t = 0
	/**
	 * @returns {number} 测试时钟
	 */
	const now = () => t
	const q = new TestQueues({ prepSettleMs: 1, now })
	q.enqueueCli({ key: 'same', viewerId: 'v' })
	q.hitPrep('same')
	t = 1
	q.promotePrep()
	assertEquals(q.cli.length, 1)
	assertEquals(q.fs.length, 1)
	const removed = q.completeCli('same')
	assertEquals(removed.length, 1)
	assertEquals(q.fs.length, 0)
})

Deno.test('viewer disconnect removes its CLI items only', () => {
	const q = new TestQueues()
	q.enqueueCli({ key: 'a', viewerId: 'v1' })
	q.enqueueCli({ key: 'b', viewerId: 'v2' })
	q.enqueueCli({ key: 'a', viewerId: 'v2' })
	const removed = q.removeViewer('v2')
	assertEquals(removed.map(item => item.key), ['b', 'a'])
	assertEquals(q.cli.map(item => item.key), ['a'])
})

Deno.test('prep hit resets settle and pulls back from FS', () => {
	let t = 0
	/**
	 * @returns {number} 测试时钟
	 */
	const now = () => t
	const q = new TestQueues({ prepSettleMs: 10, now })
	q.hitPrep('x')
	t = 10
	q.promotePrep()
	assertEquals(q.fs.length, 1)
	q.hitPrep('x')
	assertEquals(q.fs.length, 0)
	assertEquals(q.prep.has('x'), true)
	t = 15
	q.promotePrep()
	assertEquals(q.fs.length, 0)
	t = 20
	q.promotePrep()
	assertEquals(q.fs[0].key, 'x')
})

Deno.test('removeKey drops prep and both queues', () => {
	let t = 0
	/**
	 * @returns {number} 测试时钟
	 */
	const now = () => t
	const q = new TestQueues({ prepSettleMs: 1, now })
	q.enqueueCli({ key: 'gone', viewerId: 'v' })
	q.hitPrep('gone')
	t = 1
	q.promotePrep()
	const removed = q.removeKey('gone')
	assertEquals(removed.length, 2)
	assertEquals(q.allEmpty(), true)
})
