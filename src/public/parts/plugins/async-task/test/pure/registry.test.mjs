/* global Deno */
/**
 * async-task 纯注册表测试：任务登记/结算/释放、通知投递、list 过滤与 await 的 all/any/超时语义。
 */
import { assert, assertEquals } from 'jsr:@std/assert'

import {
	awaitTasks,
	getTask,
	listTasks,
	ownerFromArgs,
	registerTask,
	resetAsyncTaskState,
	setAsyncTaskNotifier,
	takePendingNotifications,
} from '../../registry.mjs'

/**
 * 构造归属。
 * @param {object} [extra] 覆盖字段
 * @returns {object} 归属
 */
function owner(extra = {}) {
	return { username: 'u', charId: 'c', chatName: 'chat-1', parentRunId: null, ...extra }
}

/**
 * 构造一个立即返回给定结果的执行函数。
 * @param {unknown} value 结果
 * @returns {() => Promise<unknown>} 执行函数
 */
function resolveWith(value) {
	return async () => value
}

/**
 * 构造一个总是抛错的执行函数。
 * @returns {() => Promise<never>} 执行函数
 */
function alwaysThrow() {
	return async () => { throw new Error('boom') }
}

/**
 * 构造一个永不完成的执行函数。
 * @returns {() => Promise<unknown>} 执行函数
 */
function neverResolves() {
	return () => new Promise(() => { })
}

/**
 * 构造一个可手动放行的执行函数。
 * @returns {{run: () => Promise<unknown>, release: (value: unknown) => void}} 执行函数与放行器
 */
function deferred() {
	/** @type {(value: unknown) => void} */
	let release = () => { }
	const promise = new Promise(resolve => { release = resolve })
	return {
		/**
		 * 后台执行函数。
		 * @returns {Promise<unknown>} 待放行的 Promise
		 */
		run: () => promise,
		/**
		 * 放行 Promise。
		 * @param {unknown} value 结果
		 * @returns {void}
		 */
		release: value => release(value),
	}
}

Deno.test('registerTask settles, notifies, and releases the task', async () => {
	resetAsyncTaskState()
	const target = owner()
	const task = registerTask({ kind: 'js', label: 'demo', owner: target, run: resolveWith('hello') })
	assertEquals(getTask(task.id)?.state, 'running')

	const settled = await task.done
	assertEquals(settled.state, 'done')
	assertEquals(settled.result, 'hello')
	assertEquals(settled.consumed, false)
	assertEquals(getTask(task.id), undefined)

	const notes = takePendingNotifications(target)
	assertEquals(notes.length, 1)
	assert(notes[0].content.includes('hello'))
	assertEquals(takePendingNotifications(target), [])
})

Deno.test('registerTask emits start and settle lifecycle events', async () => {
	resetAsyncTaskState()
	const events = []
	setAsyncTaskNotifier(event => events.push(event))
	const target = owner()
	const task = registerTask({ kind: 'js', label: 'demo', owner: target, run: resolveWith('ok') })
	assertEquals(events.length, 1)
	assertEquals(events[0].phase, 'start')
	assertEquals(events[0].task.id, task.id)
	assertEquals(events[0].task.state, 'running')

	await task.done
	const settle = events.find(event => event.phase === 'settle')
	assertEquals(settle.task.id, task.id)
	assertEquals(settle.task.state, 'done')
	assert(!('result' in settle.task), '生命周期事件不应携带结果体（结果由完成通知承载）')
})

Deno.test('failed tasks record the error then release', async () => {
	resetAsyncTaskState()
	const target = owner()
	const task = registerTask({ kind: 'js', owner: target, run: alwaysThrow() })
	const settled = await task.done
	assertEquals(settled.state, 'failed')
	assertEquals(settled.error.message, 'boom')
	assertEquals(getTask(task.id), undefined)
	const notes = takePendingNotifications(target)
	assertEquals(notes.length, 1)
	assert(notes[0].content.includes('boom'))
})

Deno.test('awaitTasks all waits for every task and suppresses notifications', async () => {
	resetAsyncTaskState()
	const target = owner()
	const d1 = deferred()
	const d2 = deferred()
	const t1 = registerTask({ kind: 'js', owner: target, run: d1.run })
	const t2 = registerTask({ kind: 'js', owner: target, run: d2.run })

	const waiting = awaitTasks([t1.id, t2.id], { mode: 'all', timeoutMs: 1000 })
	d1.release('a')
	d2.release('b')
	const result = await waiting
	assertEquals(result.settled.map(task => task.result).sort(), ['a', 'b'])
	assertEquals(result.pending, [])
	assertEquals(result.timedOut, false)
	assertEquals(takePendingNotifications(target), [])
})

Deno.test('awaitTasks any returns after the first task settles', async () => {
	resetAsyncTaskState()
	const target = owner()
	const d1 = deferred()
	const d2 = deferred()
	const t1 = registerTask({ kind: 'js', owner: target, run: d1.run })
	const t2 = registerTask({ kind: 'js', owner: target, run: d2.run })

	const waiting = awaitTasks([t1.id, t2.id], { mode: 'any', timeoutMs: 1000 })
	d1.release('a')
	const result = await waiting
	assertEquals(result.settled.map(task => task.result), ['a'])
	assertEquals(result.pending, [t2.id])
	d2.release('b')
	await t2.done
})

Deno.test('awaitTasks reports pending and unknown ids on timeout', async () => {
	resetAsyncTaskState()
	const target = owner()
	const task = registerTask({ kind: 'js', owner: target, run: neverResolves() })
	const result = await awaitTasks([task.id, 'missing-id'], { mode: 'all', timeoutMs: 20 })
	assertEquals(result.timedOut, true)
	assertEquals(result.pending, [task.id])
	assertEquals(result.unknown, ['missing-id'])
})

Deno.test('listTasks filters by owner, parentRunId and kind', () => {
	resetAsyncTaskState()
	const root = owner()
	const nested = owner({ parentRunId: 'run-1' })
	registerTask({ kind: 'js', owner: root, run: neverResolves() })
	registerTask({ kind: 'subagent', owner: root, run: neverResolves() })
	registerTask({ kind: 'js', owner: nested, run: neverResolves() })

	assertEquals(listTasks({ username: 'u', charId: 'c', chatName: 'chat-1', parentRunId: null }).length, 2)
	assertEquals(listTasks({ username: 'u', charId: 'c', chatName: 'chat-1', parentRunId: null, kind: 'js' }).length, 1)
	assertEquals(listTasks({ parentRunId: 'run-1' }).length, 1)
	assertEquals(listTasks({ username: 'nobody' }).length, 0)
})

Deno.test('ownerFromArgs derives the owner from a request', () => {
	assertEquals(ownerFromArgs({ username: 'u', char_id: 'c', chat_name: 'chat-1' }), {
		username: 'u',
		charId: 'c',
		chatName: 'chat-1',
		parentRunId: null,
	})
	assertEquals(ownerFromArgs({ username: 'u', char_id: 'c', chat_name: 'chat-1', extension: { subAgent: { runId: 'p' } } }).parentRunId, 'p')
})
