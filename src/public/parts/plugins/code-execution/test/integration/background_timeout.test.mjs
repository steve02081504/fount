/* global Deno */
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { flattenReplyHandlers } from '../../../../shells/chat/src/reply/defineReplyHandler.mjs'
import { awaitTasks, inspectTask, listTasks, ownerFromArgs, resetAsyncTaskState, stopTask } from '../../../async-task/registry.mjs'
import { getCodeExecutionReplyHandlers, runJsReplyHandler } from '../../handler.mjs'

/**
 * 创建隔离的生成上下文。
 * @returns {object} Request and logs.
 */
function context() {
	const logs = []
	const args = {
		username: 'timeout-test', char_id: 'char', chat_name: 'test',
		Charname: 'TestChar', chat_log: [], plugins: {}, supported_functions: {},
		workdir: { machine: '0' }, chat_scoped_char_memory: {},
		extension: { generationId: crypto.randomUUID() },
		/**
		 * 收集工具记录。
		 * @param {object} entry Log entry.
		 * @returns {void} No return value.
		 */
		AddLongTimeLog: entry => { logs.push(entry) },
	}
	return { args, logs }
}

Deno.test('run-js timeout adopts the same promise and keeps the full result', async () => {
	resetAsyncTaskState()
	const { args, logs } = context()
	const workspace = args.chat_scoped_char_memory.coderunner_workspace = {}
	let release
	workspace.wait = new Promise(resolve => { release = resolve })
	const events = []
	args.generation_options = {
		/**
		 * 收集流式事件。
		 * @param {object} event Output event.
		 * @returns {number} New event count.
		 */
		onToolOutput: event => events.push(event),
	}
	try {
		const outcome = await runJsReplyHandler.handle({}, args, {
			params: { expect: '0.02s' },
			inner: 'workspace.count = (workspace.count ?? 0) + 1; console.log("before"); await workspace.wait; console.log("after"); return 42',
		})
		assertEquals(outcome, { regen: true, pending: true })
		assertEquals(workspace.count, 1)
		const id = logs[0].extension.asyncTask.id
		assertStringIncludes(logs[0].content, '已等待')
		assertStringIncludes(logs[0].content, '超时')
		assertStringIncludes(logs[0].content, '执行未被打断、继续在后台运行')
		assertStringIncludes(logs[0].content, `<inspect-async id="${id}"/>`)
		assertStringIncludes(logs[0].content_for_show, '已等待')
		assert(inspectTask(id, ownerFromArgs(args)).ok)
		assertEquals((await stopTask(id, ownerFromArgs(args))).reason, 'unsupported')
		const eventCount = events.length
		release()
		const result = await awaitTasks([id], { requester: ownerFromArgs(args) })
		assertStringIncludes(result.settled[0].result, 'before')
		assertStringIncludes(result.settled[0].result, 'after')
		assertStringIncludes(result.settled[0].result, '42')
		assertEquals(workspace.count, 1)
		assertEquals(events.length, eventCount)
	} finally { release(); resetAsyncTaskState() }
})

Deno.test('foreground and explicit async runs keep their respective semantics', async () => {
	resetAsyncTaskState()
	const { args, logs } = context()
	assertEquals(await runJsReplyHandler.handle({}, args, { params: { wait: 'forever' }, inner: 'return 7' }), { regen: true })
	assertStringIncludes(logs[0].content, '7')
	assertEquals(listTasks().length, 0)
	const outcome = await runJsReplyHandler.handle({}, args, { params: { async: 'true', expect: '0.001s' }, inner: 'return 8' })
	assertEquals(outcome.pending, true)
	const id = logs.at(-1).extension.asyncTask.id
	assertStringIncludes((await awaitTasks([id], { requester: ownerFromArgs(args) })).settled[0].result, '8')
	const handlers = flattenReplyHandlers(getCodeExecutionReplyHandlers())
	assert(handlers.some(handler => handler.name === 'stop-async'))
	resetAsyncTaskState()
})

Deno.test('shell timeout keeps the process alive and stop enforces ownership', async () => {
	resetAsyncTaskState()
	const { args, logs } = context()
	const shell = Deno.build.os === 'windows' ? 'pwsh' : 'sh'
	const handlers = getCodeExecutionReplyHandlers({
		/**
		 * 解析测试用 shell。
		 * @returns {Promise<string[]>} Shell names.
		 */
		resolveShells: async () => [shell],
	})
	const handler = handlers.find(item => item.name === `run-${shell}`)
	const outcome = await handler.handle({}, args, {
		params: { expect: '0.1s' },
		inner: shell === 'pwsh' ? 'Write-Output before; Start-Sleep -Seconds 30; Write-Output after' : 'echo before; sleep 30; echo after',
	})
	assertEquals(outcome.pending, true)
	const id = logs[0].extension.asyncTask.id
	try {
		assertStringIncludes(logs[0].content, '<stop-async id="任务id"/>')
		assertStringIncludes(logs[0].content, id)
		assertEquals((await stopTask(id, { ...ownerFromArgs(args), chatName: 'other', chatScopeId: 'other' })).reason, 'forbidden')
		assert(listTasks().some(task => task.id === id))
		// Allow local shell initialization before requesting termination.
		await new Promise(resolve => setTimeout(resolve, 1500))
		assertEquals((await stopTask(id, ownerFromArgs(args))).ok, true)
		const result = await awaitTasks([id], { requester: ownerFromArgs(args), timeoutMs: 5000 })
		assertEquals(result.pending, [])
		assertEquals(result.settled[0].state, 'failed')
	} finally {
		await stopTask(id, ownerFromArgs(args))
		resetAsyncTaskState()
	}
})

Deno.test('shell result after the foreground deadline preserves both output phases', async () => {
	resetAsyncTaskState()
	const { args, logs } = context()
	const shell = Deno.build.os === 'windows' ? 'powershell' : 'sh'
	const handlers = getCodeExecutionReplyHandlers({
		/**
		 * 解析测试用 shell。
		 * @returns {Promise<string[]>} Shell names.
		 */
		resolveShells: async () => [shell],
	})
	const handler = handlers.find(item => item.name === `run-${shell}`)
	const outcome = await handler.handle({}, args, {
		params: { expect: '0.01s' },
		inner: shell === 'powershell' ? 'Write-Output before; Start-Sleep -Milliseconds 200; Write-Output after' : 'echo before; sleep 0.2; echo after',
	})
	assertEquals(outcome.pending, true)
	const id = logs[0].extension.asyncTask.id
	const result = await awaitTasks([id], { requester: ownerFromArgs(args), timeoutMs: 10000 })
	assertEquals(result.pending, [])
	assertEquals(result.settled[0].state, 'done')
	assertStringIncludes(result.settled[0].result, 'before')
	assertStringIncludes(result.settled[0].result, 'after')
	resetAsyncTaskState()
})
