/* global Deno */
/**
 * async-task ReplyHandler 集成测试：`<list-async>` 与 `<await-async>` 的工具回执语义。
 */
import { assert, assertEquals } from 'jsr:@std/assert'

import { awaitAsyncHandler, listAsyncHandler } from '../../handler.mjs'
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
	assert(args.logs[0].content.includes('do a thing'))
	assert(args.logs[0].content.includes(task.id))

	args.logs.length = 0
	await listAsyncHandler.handle(null, args, { params: { kind: 'js' } })
	assert(args.logs[0].content.includes('没有进行中'))
})

Deno.test('await-async waits and returns the settled result', async () => {
	resetAsyncTaskState()
	const args = createArgs()
	const task = registerTask({ kind: 'js', label: 'x', owner: ownerFromArgs(args), run: resolveWith('RESULT-TEXT') })

	await awaitAsyncHandler.handle(null, args, { params: { ids: task.id, mode: 'all' } })
	const last = args.logs.at(-1)
	assert(last.content.includes('RESULT-TEXT'))
	assert(last.content.includes('已完成'))
})

Deno.test('await-async errors without ids', async () => {
	resetAsyncTaskState()
	const args = createArgs()
	await awaitAsyncHandler.handle(null, args, { params: {} })
	assertEquals(args.logs.at(-1).extension?.error, true)
})
