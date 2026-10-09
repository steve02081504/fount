/**
 * 并发上限工具测试：并发窗口、顺序、全量执行、错误传播。
 */
/* global Deno */
import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { runWithConcurrency, runWithConcurrencyPerGroup } from '../../scripts/lib/concurrency.mjs'

/**
 * 构造一个可手动放行的异步闸门。
 * @returns {{ promise: Promise<void>, release: () => void }} 闸门
 */
function createGate() {
	let release
	const promise = new Promise(resolve => { release = resolve })
	return { promise, release }
}

Deno.test('runWithConcurrency never exceeds the limit and returns results in item order', async () => {
	let inFlight = 0
	let peak = 0
	const gates = Array.from({ length: 10 }, createGate)
	const finished = []
	const pending = runWithConcurrency([...gates.keys()], 3, async index => {
		inFlight++
		peak = Math.max(peak, inFlight)
		await gates[index].promise
		inFlight--
		finished.push(index)
		return index * 2
	})

	// 只有前 3 个槽位能启动；其余必须排队等待前面的闸门放行。
	await Promise.resolve()
	assertEquals(peak, 3)
	assertEquals(finished, [])
	for (const gate of gates) gate.release()
	assertEquals(await pending, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18])
	assertEquals(peak, 3)
	assertEquals([...finished].sort((a, b) => a - b), [...gates.keys()])
})

Deno.test('runWithConcurrency runs every item exactly once for limits above and equal to the list length', async () => {
	const seen = []
	const results = await runWithConcurrency(['a', 'b', 'c'], 8, async item => {
		seen.push(item)
		return item.toUpperCase()
	})
	assertEquals(results, ['A', 'B', 'C'])
	assertEquals([...seen].sort(), ['a', 'b', 'c'])
})

Deno.test('runWithConcurrency treats an empty list and a non-positive limit as degenerate but safe', async () => {
	assertEquals(await runWithConcurrency([], 3, async () => 'never'), [])
	assertEquals(await runWithConcurrency(['only'], 0, async item => item), ['only'])
})

Deno.test('runWithConcurrency propagates the worker error and stops launching new work', async () => {
	const started = []
	await assertRejects(
		() => runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async item => {
			started.push(item)
			if (item === 2) throw new Error('boom')
			await new Promise(resolve => setTimeout(resolve, 5))
			return item
		}),
		Error,
		'boom',
	)
	// 槽位 1 与 2 会先启动（2 立即抛错），停止派发后 5、6 不应被启动。
	assertEquals(started.includes(5), false)
	assertEquals(started.includes(6), false)
})

Deno.test('runWithConcurrencyPerGroup limits every group on its own and keeps the order inside a group', async () => {
	const items = [
		{ host: 'a', id: 1 }, { host: 'b', id: 2 }, { host: 'a', id: 3 },
		{ host: 'b', id: 4 }, { host: 'a', id: 5 }, { host: 'b', id: 6 },
	]
	const inFlight = { a: 0, b: 0 }
	const peak = { a: 0, b: 0 }
	const startedIds = []
	const gates = new Map(items.map(item => [item.id, createGate()]))

	/**
	 * 按 host 分组。
	 * @param {{ host: string }} item - 待处理项
	 * @returns {string} 分组键
	 */
	const keyOf = item => item.host
	/**
	 * 记录每个 host 的并发峰值与启动顺序，然后等自己的闸门放行。
	 * @param {{ host: 'a' | 'b', id: number }} item - 待处理项
	 * @returns {Promise<void>} 无返回值
	 */
	const worker = async item => {
		inFlight[item.host]++
		peak[item.host] = Math.max(peak[item.host], inFlight[item.host])
		startedIds.push(item.id)
		await gates.get(item.id).promise
		inFlight[item.host]--
	}
	const pending = runWithConcurrencyPerGroup(items, { limit: 2, keyOf, worker })
	await Promise.resolve()

	// 每个 host 只跑到自己的上限；两个 host 同时在跑，说明组间不互相排队。
	assertEquals(peak, { a: 2, b: 2 })
	assertEquals(startedIds.slice().sort((x, y) => x - y), [1, 2, 3, 4])
	// 组内按传入顺序拿号：a 组先 1、3，b 组先 2、4。
	assertEquals(startedIds.filter(id => id % 2 === 1), [1, 3])
	assertEquals(startedIds.filter(id => id % 2 === 0), [2, 4])

	for (const gate of gates.values()) gate.release()
	await pending
	assertEquals(startedIds.slice().sort((x, y) => x - y), [1, 2, 3, 4, 5, 6])
})

Deno.test('runWithConcurrencyPerGroup handles an empty list and a single group', async () => {
	/**
	 * 常量分组键：所有项落在同一个组里。
	 * @returns {string} 分组键
	 */
	const sameGroup = () => 'same'
	/**
	 * 不做任何事的 worker。
	 * @returns {Promise<string>} 固定值
	 */
	const noop = async () => 'never'
	assertEquals(await runWithConcurrencyPerGroup([], { limit: 3, keyOf: sameGroup, worker: noop }), undefined)

	const seen = []
	/**
	 * 记录处理顺序的 worker。
	 * @param {string} item - 待处理项
	 * @returns {Promise<void>} 无返回值
	 */
	const record = async item => { seen.push(item) }
	await runWithConcurrencyPerGroup(['a', 'b'], { limit: 1, keyOf: sameGroup, worker: record })
	assertEquals(seen, ['a', 'b'])
})
