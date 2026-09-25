/* global Deno */
/**
 * async-task ReplyHandler 集成测试：`<list-async>` 与 `<await-async>` 的工具回执语义。
 */
import { assert, assertEquals } from 'jsr:@std/assert'

import { awaitAsyncHandler, inspectAsyncHandler, listAsyncHandler } from '../../handler.mjs'
import { ownerFromArgs, registerTask, resetAsyncTaskState } from '../../registry.mjs'

/**
 * 生成把日志写入数组的 AddLongTimeLog 回调。
 * @param {object[]} logs 日志数组
 * @returns {(entry: object) => void} 回调
 */
function makeLogCollector(logs) {
	return entry => logs.push(entry)
}

/**
 * 构造一个永不完成的执行函数。
 * @returns {() => Promise<unknown>} 执行函数
 */
function neverResolves() {
	return () => new Promise(() => { })
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
 * 构造捕获工具日志的请求上下文。
 * @param {object} [extra] 覆盖字段
 * @returns {object} 请求上下文
 */
function createArgs(extra = {}) {
	const logs = []
	return {
		username: 'u',
		char_id: 'c',
		chat_name: 'chat-1',
		extension: {},
		generation_options: {},
		AddLongTimeLog: makeLogCollector(logs),
		logs,
		...extra,
	}
}

Deno.test('list-async reports in-flight tasks for the current owner', async () => {
	resetAsyncTaskState()
	const args = createArgs()
	const task = registerTask({ kind: 'subagent', label: 'do a thing', owner: ownerFromArgs(args), run: neverResolves() })

	await listAsyncHandler.handle(null, args, { params: {} })
	assertEquals(args.logs.length, 1)
	assertEquals(args.logs[0].name, 'async-task.list')
	assert(args.logs[0].content.includes('do a thing'))
	assert(args.logs[0].content.includes(task.id))
	assertEquals(args.logs[0].extension?.asyncList?.tasks?.length, 1)
	assertEquals(args.logs[0].extension.asyncList.tasks[0].id, task.id)

	args.logs.length = 0
	await listAsyncHandler.handle(null, args, { params: { kind: 'js' } })
	assertEquals(args.logs[0].name, 'async-task.list')
	assert(args.logs[0].content.includes('没有进行中'))
	assertEquals(args.logs[0].extension?.asyncList?.tasks, [])
})

Deno.test('await-async waits and returns the settled result', async () => {
	resetAsyncTaskState()
	const args = createArgs()
	const task = registerTask({ kind: 'js', label: 'x', owner: ownerFromArgs(args), run: resolveWith('RESULT-TEXT') })

	await awaitAsyncHandler.handle(null, args, { params: { ids: task.id, mode: 'all' } })
	const last = args.logs.at(-1)
	assertEquals(last.name, 'async-task.await')
	assert(last.content.includes('RESULT-TEXT'))
	assert(last.content.includes('已完成'))
	assertEquals(last.extension?.asyncAwait?.mode, 'all')
	assertEquals(last.extension.asyncAwait.settled.length, 1)
	assertEquals(last.extension.asyncAwait.settled[0].state, 'done')
	assert(last.extension.asyncAwait.settled[0].result.includes('RESULT-TEXT'))
})

Deno.test('await-async retrieves a task completed before the parent generation ends', async () => {
	resetAsyncTaskState()
	const args = createArgs({ extension: { generationId: 'parent-generation' } })
	const task = registerTask({ kind: 'subagent', owner: ownerFromArgs(args), run: resolveWith({ finalText: 'CHILD-ANSWER' }) })
	await task.done
	await awaitAsyncHandler.handle(null, args, { params: { ids: task.id } })
	assert(args.logs.at(-1).content.includes('CHILD-ANSWER'))
	assertEquals(args.logs.at(-1).extension.asyncAwait.settled[0].id, task.id)
})

Deno.test('await-async errors without ids', async () => {
	resetAsyncTaskState()
	const args = createArgs()
	await awaitAsyncHandler.handle(null, args, { params: {} })
	assertEquals(args.logs.at(-1).extension?.error, true)
})

Deno.test('inspect-async returns a running task preview without consuming it', async () => {
	resetAsyncTaskState()
	const args = createArgs()
	const task = registerTask({
		kind: 'pwsh',
		label: 'do a thing',
		owner: ownerFromArgs(args),
		run: neverResolves(),
		/**
		 * 检视回调。
		 * @returns {string} 最新输出
		 */
		inspect: () => 'tail of output',
	})

	await inspectAsyncHandler.handle(null, args, { params: { id: task.id } })
	const log = args.logs.at(-1)
	assertEquals(log.name, 'async-task.inspect')
	assert(log.content.includes('tail of output'))
	assertEquals(log.extension?.asyncInspect?.id, task.id)
	assert(log.extension.asyncInspect.preview.includes('```ansi'), '预览应包进 ansi 代码块，避免被 markdown 解析')
	assert(log.extension.asyncInspect.preview.includes('tail of output'))
	assertEquals(task.consumed, false, '检视不应消费任务，完成后仍应通知')
})

Deno.test('inspect-async surfaces structured sub-agent entries', async () => {
	resetAsyncTaskState()
	const args = createArgs()
	const task = registerTask({
		kind: 'subagent',
		owner: ownerFromArgs(args),
		run: neverResolves(),
		/**
		 * 检视回调。
		 * @returns {object} 结构化检视载荷
		 */
		inspect: () => ({ state: 'running', rounds: 1, roundLimit: 3, entries: [{ role: 'char', name: 'Char', content: 'hi' }] }),
	})

	await inspectAsyncHandler.handle(null, args, { params: { id: task.id } })
	const log = args.logs.at(-1)
	assertEquals(log.extension.asyncInspect.state, 'running')
	assertEquals(log.extension.asyncInspect.entries.length, 1)
	assert(log.content.includes('[char] Char: hi'))
})

Deno.test('inspect-async reports failures for missing ids', async () => {
	resetAsyncTaskState()
	const args = createArgs()
	await inspectAsyncHandler.handle(null, args, { params: {} })
	assertEquals(args.logs.at(-1).name, 'async-task.inspect')
	assertEquals(args.logs.at(-1).extension?.error, true)

	args.logs.length = 0
	await inspectAsyncHandler.handle(null, args, { params: { id: 'nope' } })
	assertEquals(args.logs.at(-1).extension?.error, true)
	assert(args.logs.at(-1).content.includes('未找到'))
})
