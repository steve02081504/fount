/* global Deno */
/**
 * async-task 纯注册表测试：任务登记/结算/释放、通知投递、list 过滤与 await 的 all/any/超时语义。
 */
import { assert, assertEquals } from 'jsr:@std/assert'

import {
	awaitTasks,
	getTask,
	inspectTask,
	listTasks,
	listTasksForOwner,
	notificationQueueKey,
	ownerFromArgs,
	pushPendingNotification,
	registerChannel,
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

Deno.test('awaitTasks any re-arms the unsettled tasks so they still notify later', async () => {
	resetAsyncTaskState()
	const target = owner()
	const d1 = deferred()
	const d2 = deferred()
	const t1 = registerTask({ kind: 'js', owner: target, run: d1.run })
	const t2 = registerTask({ kind: 'js', owner: target, run: d2.run })

	const waiting = awaitTasks([t1.id, t2.id], { mode: 'any', timeoutMs: 1000 })
	d1.release('a')
	const result = await waiting
	assertEquals(result.pending, [t2.id])
	assertEquals(t2.consumed, false, '未结算任务应复位消费标记')

	d2.release('b')
	await t2.done
	const notes = takePendingNotifications(target)
	assertEquals(notes.length, 1, 'any 返回后仍未结算的任务日后完成应通知')
	assert(notes[0].content.includes('b'))
})

Deno.test('awaitTasks timeout re-arms the pending tasks so they still notify later', async () => {
	resetAsyncTaskState()
	const target = owner()
	const d = deferred()
	const task = registerTask({ kind: 'js', owner: target, run: d.run })

	const result = await awaitTasks([task.id], { mode: 'all', timeoutMs: 20 })
	assertEquals(result.timedOut, true)
	assertEquals(result.pending, [task.id])
	assertEquals(task.consumed, false, '超时后未结算任务应复位消费标记')

	d.release('late')
	await task.done
	const notes = takePendingNotifications(target)
	assertEquals(notes.length, 1, '超时后仍未结算的任务日后完成应通知')
	assert(notes[0].content.includes('late'))
})

Deno.test('awaitTasks keeps settled tasks consumed after the wait', async () => {
	resetAsyncTaskState()
	const target = owner()
	const d = deferred()
	const task = registerTask({ kind: 'js', owner: target, run: d.run })

	const waiting = awaitTasks([task.id], { mode: 'all', timeoutMs: 1000 })
	d.release('done')
	const result = await waiting
	assertEquals(result.settled.length, 1)
	assertEquals(task.consumed, true, '已结算任务保持消费，不再重复通知')
	assertEquals(takePendingNotifications(target), [])
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

Deno.test('awaitTasks puts unknown-only ids in unknown, never in pending', async () => {
	resetAsyncTaskState()
	const result = await awaitTasks(['bogus-1', 'bogus-2'], { mode: 'all', timeoutMs: 20 })
	assertEquals(result.settled, [])
	assertEquals(result.pending, [], '未知 id 不应同时被报为进行中')
	assertEquals(result.unknown, ['bogus-1', 'bogus-2'])
	assertEquals(result.timedOut, false)
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

Deno.test('pending notifications are scoped per chat thread', () => {
	resetAsyncTaskState()
	const chatA = owner({ chatName: 'chat-a' })
	const chatB = owner({ chatName: 'chat-b' })
	assertEquals(notificationQueueKey(chatA), 'root|u|c|chat-a')
	assertEquals(notificationQueueKey(chatB), 'root|u|c|chat-b')
	assertEquals(notificationQueueKey(owner({ parentRunId: 'p' })), 'run|p')

	pushPendingNotification(chatA, { content: 'note-a' })
	pushPendingNotification(chatB, { content: 'note-b' })
	assertEquals(takePendingNotifications(chatA).map(entry => entry.content), ['note-a'])
	assertEquals(takePendingNotifications(chatB).map(entry => entry.content), ['note-b'])
})

Deno.test('deliverNotification never posts to another chat thread', async () => {
	resetAsyncTaskState()
	const replies = []
	const channel = {
		chat_name: 'chat-b',
		chat_log: [],
		Charname: 'Char',
		/**
		 * 返回自身。
		 * @returns {Promise<object>} 自身
		 */
		Update: async () => channel,
		/**
		 * 记录角色回复。
		 * @param {object} entry 条目
		 * @returns {Promise<void>}
		 */
		AddChatLogEntry: async entry => { replies.push(entry) },
		char: {
			interfaces: {
				chat: {
					/**
					 * 模拟角色回复。
					 * @returns {Promise<{ content: string }>} 回复
					 */
					GetReply: async () => ({ content: 'hi' }),
				},
			},
		},
	}
	registerChannel('u', 'c', channel)
	const target = owner({ chatName: 'chat-a' })
	const task = registerTask({ kind: 'js', owner: target, run: resolveWith('x') })
	await task.done
	assertEquals(replies.length, 0, '不应投递到其它聊天线程的活跃频道')
	assertEquals(takePendingNotifications(target).length, 1, '应落入本线程待注入队列')
})

/**
 * 构造一个记录 `AddChatLogEntry` 的假频道。
 * @param {object} [options] 选项
 * @param {string} [options.chatName] 频道名
 * @param {string} [options.channelId] 频道 id
 * @returns {{channel: object, appended: object[]}} 假频道与捕获数组
 */
function deliveryChannel({ chatName = 'chat-1', channelId = undefined } = {}) {
	const appended = []
	/**
	 * 记录追加条目。
	 * @param {object} entry 条目
	 * @returns {Promise<void>}
	 */
	const addChatLogEntry = async entry => { appended.push(entry) }
	const channel = {
		chat_name: chatName,
		extension: channelId ? { channelId } : {},
		AddChatLogEntry: addChatLogEntry,
	}
	return { channel, appended }
}

/**
 * 等待微任务链排空（deliverNotification 为 fire-and-forget）。
 * @returns {Promise<void>}
 */
async function flushAsync() {
	for (let i = 0; i < 8; i++) await Promise.resolve()
}

Deno.test('deliverNotification appends a char-visible notice via AddChatLogEntry', async () => {
	resetAsyncTaskState()
	const fake = deliveryChannel()
	registerChannel('u', 'c', fake.channel)
	const target = owner()
	const task = registerTask({ kind: 'js', owner: target, run: resolveWith('done') })
	await task.done
	await flushAsync()
	assertEquals(fake.appended.length, 1, '应把通知作为条目追加进频道')
	assertEquals(fake.appended[0].role, 'system')
	assertEquals(fake.appended[0].charVisibility, ['c'], '通知只对目标角色可见（不入 DAG）')
	assertEquals(takePendingNotifications(target), [], '已投递则为空')
})

Deno.test('deliverNotification matches the channel by channel-scoped id', async () => {
	resetAsyncTaskState()
	const wrong = deliveryChannel({ chatName: 'chat-1', channelId: 'other' })
	const right = deliveryChannel({ chatName: 'chat-1', channelId: 'general' })
	registerChannel('u', 'c', wrong.channel)
	registerChannel('u', 'c', right.channel)
	const target = owner({ channelId: 'general', chatScopeId: 'chat-1::general' })
	const task = registerTask({ kind: 'js', owner: target, run: resolveWith('done') })
	await task.done
	await flushAsync()
	assertEquals(wrong.appended.length, 0, '同群不同频道不应串台')
	assertEquals(right.appended.length, 1)
})

Deno.test('inspectTask reads a running task preview without consuming it', () => {
	resetAsyncTaskState()
	const target = owner()
	const task = registerTask({
		kind: 'js',
		owner: target,
		run: neverResolves(),
		/**
		 * 检视回调。
		 * @returns {string} 预览
		 */
		inspect: () => 'latest-output',
	})
	const result = inspectTask(task.id, target)
	assertEquals(result.ok, true)
	assertEquals(result.preview, 'latest-output')
	assertEquals(result.task.id, task.id)
	assertEquals(task.consumed, false, '检视不应消费任务')
})

Deno.test('inspectTask rejects unknown, unsupported and foreign tasks', async () => {
	resetAsyncTaskState()
	const target = owner()
	const plain = registerTask({ kind: 'js', owner: target, run: neverResolves() })
	assertEquals(inspectTask('missing-id', target).reason, 'not_found')
	assertEquals(inspectTask(plain.id, target).reason, 'unsupported', '无 inspect 回调视为不支持')
	assertEquals(inspectTask(plain.id, owner({ chatName: 'chat-2' })).reason, 'forbidden', '跨聊天作用域不可检视')
	assertEquals(inspectTask(plain.id, owner({ charId: 'other' })).reason, 'forbidden', '跨角色不可检视')

	// 结算后任务被释放，检视回落 not_found（完成结果由通知 / await 承载）
	const done = registerTask({
		kind: 'js',
		owner: target,
		run: resolveWith('x'),
		/**
		 * 检视回调。
		 * @returns {string} 预览
		 */
		inspect: () => 'y',
	})
	await done.done
	assertEquals(inspectTask(done.id, target).reason, 'not_found')
})

Deno.test('listTasksForOwner expands an owner into filter fields', () => {
	resetAsyncTaskState()
	const chatA = owner({ chatName: 'chat-a' })
	const chatB = owner({ chatName: 'chat-b' })
	registerTask({ kind: 'js', owner: chatA, run: neverResolves() })
	registerTask({ kind: 'js', owner: chatB, run: neverResolves() })
	registerTask({ kind: 'js', owner: owner({ chatName: 'chat-a', parentRunId: 'run-1' }), run: neverResolves() })

	assertEquals(listTasksForOwner(chatA).length, 1)
	assertEquals(listTasksForOwner(chatA, { kind: 'subagent' }).length, 0)
	assertEquals(listTasksForOwner({ chatName: 'chat-a', parentRunId: 'run-1' }).length, 1)
})

Deno.test('ownerFromArgs derives the owner from a request', () => {
	assertEquals(ownerFromArgs({ username: 'u', char_id: 'c', chat_name: 'chat-1' }), {
		username: 'u',
		charId: 'c',
		chatName: 'chat-1',
		channelId: null,
		chatScopeId: 'chat-1',
		parentRunId: null,
	})
	assertEquals(ownerFromArgs({ username: 'u', char_id: 'c', chat_name: 'chat-1', extension: { subAgent: { runId: 'p' } } }).parentRunId, 'p')
	assertEquals(ownerFromArgs({ username: 'u', char_id: 'c', chat_name: 'chat-1', extension: { channelId: 'general' } }).chatScopeId, 'chat-1::general')
})
