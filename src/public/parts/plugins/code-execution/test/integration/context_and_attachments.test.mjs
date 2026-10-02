/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { attachmentFilename, toFileObj } from '../../../../../../scripts/file_object.mjs'
import { runReplyHandlers } from '../../../../shells/chat/src/reply/handlerPipeline.mjs'
import { awaitTasks, getTask, ownerFromArgs, resetAsyncTaskState, setAsyncToolingEnabled, takePendingNotifications } from '../../../async-task/registry.mjs'
import { getCodeExecutionReplyHandlers } from '../../handler.mjs'

/**
 * 构造一个隔离的聊天请求，并收集工具日志。
 * @returns {object} Fixture.
 */
function fixture() {
	const logs = []
	return { logs, args: { char_id: 'test-char', username: 'test-user', Charname: 'Test', chat_log: [], plugins: {}, chat_scoped_char_memory: {}, supported_functions: {}, /**
	 *
	 * @param {object} entry Collected tool log.
	 * @returns {number} Number of logs.
	 */
		AddLongTimeLog: entry => logs.push(entry) } }
}

Deno.test('inline-js shares workspace and plugin contexts with subsequent run-js', async () => {
	const { args, logs } = fixture()
	args.plugins.context = { interfaces: { code_execution: { /**
	 * 提供一个插件上下文。
	 * @returns {Promise<object>} Context variables.
	 */
		GetJSCodeContext: async () => ({ supplied: 17 }) } } }
	const first = { content: '<inline-js>workspace.answer = supplied; workspace.answer</inline-js>' }
	await runReplyHandlers(first, args, getCodeExecutionReplyHandlers())
	assertStringIncludes(first.content_for_show, '17')
	const second = { content: '<run-js>workspace.answer + supplied</run-js>' }
	await runReplyHandlers(second, args, getCodeExecutionReplyHandlers())
	assert(logs.some(entry => entry.name === 'code-execution.run-js' && entry.content.includes('34')))
	const other = fixture()
	const isolated = { content: '<inline-js>workspace.answer === undefined</inline-js>' }
	await runReplyHandlers(isolated, other.args, getCodeExecutionReplyHandlers())
	assertStringIncludes(isolated.content_for_show, 'true')
})

Deno.test('wait-screen records the selected monitor attachment and rejects invalid waits', async () => {
	const { args, logs } = fixture()
	let selected
	const handlers = getCodeExecutionReplyHandlers({ /**
	 *
	 * @param {number} monitor Selected monitor.
	 * @returns {Promise<string>} PNG base64.
	 */
		capture: async monitor => { selected = monitor; return Buffer.from('image').toString('base64') } })
	await runReplyHandlers({ content: '<wait-screen seconds="0" monitor="2"/>' }, args, handlers)
	assertEquals(selected, 2)
	assertEquals(logs.find(entry => entry.name === 'code-execution.wait-screen').files[0].buffer.toString(), 'image')
	await runReplyHandlers({ content: '<wait-screen>-1</wait-screen>' }, args, handlers)
	assert(logs.some(entry => entry.extension?.error && entry.content.includes('between 0 and 3600')))
})

Deno.test('attachment names prefer encoded Content-Disposition and discard directory prefixes', () => {
	assertEquals(attachmentFilename('https://example.com/download', 'attachment; filename=old.txt; filename*=UTF-8\'\'%E6%8A%A5%E5%91%8A.pdf'), '报告.pdf')
	assertEquals(attachmentFilename('https://example.com/a.txt', 'attachment; filename="../report.txt"'), 'report.txt')
	assertEquals(attachmentFilename('https://example.com/%E6%8A%A5%E5%91%8A.txt'), '报告.txt')
})

Deno.test('attachment normalization detects content MIME, preserves descriptions and handles generic HTTP MIME', async () => {
	const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex')
	const normalized = await toFileObj({ name: 'wrong.txt', buffer: png, description: 'screen' })
	assertEquals(normalized.mime_type, 'image/png')
	assertEquals(normalized.description, 'screen')
	const downloaded = await toFileObj('https://example.com/download', { /**
	 * 伪造的 HTTP 下载。
	 * @returns {Promise<Response>} Attachment response.
	 */
		fetchImpl: async () => new Response('hello', { headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename*=UTF-8\'\'report.json' } }) })
	assertEquals(downloaded.name, 'report.json')
	assertEquals(downloaded.mime_type, 'application/json')
	assertEquals(downloaded.buffer.toString(), 'hello')
})

Deno.test('awaited real async run-js emits one success or failure event even when its notification is consumed', async () => {
	resetAsyncTaskState()
	setAsyncToolingEnabled(true)
	try {
		for (const failed of [false, true]) {
			const { args, logs } = fixture()
			const events = []
			let release
			const finishGate = new Promise(resolve => { release = resolve })
			args.chat_name = 'awaited-code'
			args.extension = { generationId: crypto.randomUUID() }
			args.char = { interfaces: { plugins: {
				/**
				 * 观察已完成的后台工作。
				 * @param {object} event Plugin lifecycle event.
				 * @returns {number} Observed event count.
				 */
				OnEvent: event => events.push(event),
			} } }
			args.plugins.context = { interfaces: { code_execution: {
				/**
				 * 为真实异步 JS 执行注入一个确定性的闸门。
				 * @returns {Promise<object>} JavaScript context.
				 */
				GetJSCodeContext: async () => ({ finishGate }),
			} } }
			const code = failed ? 'await finishGate; throw new Error("expected async failure")' : 'await finishGate; return 42'
			await runReplyHandlers({ content: `<run-js async="true">${code}</run-js>` }, args, getCodeExecutionReplyHandlers())
			const id = logs.find(entry => entry.name === 'code-execution.async').extension.asyncTask.id
			assertEquals(getTask(id).state, 'running')
			const waiting = awaitTasks([id], { requester: ownerFromArgs(args) })
			assertEquals(getTask(id).consumed, true)
			release()
			const { settled } = await waiting
			assertEquals(settled.length, 1)
			assertEquals(settled[0].state, failed ? 'failed' : 'done')
			if (failed) assertStringIncludes(settled[0].error.message, 'expected async failure')
			else assertStringIncludes(settled[0].result, '42')
			assertEquals(getTask(id), undefined)
			assertEquals(takePendingNotifications(ownerFromArgs(args)), [])
			const completions = events.filter(event => event.type === 'background')
			assertEquals(completions.length, 1)
			assertEquals(completions[0].pluginName, 'code-execution')
			assertEquals(completions[0].tool, 'code-execution.run-js')
			assertEquals(completions[0].status, failed ? 'failed' : 'succeeded')
		}
	} finally {
		setAsyncToolingEnabled(false)
		resetAsyncTaskState()
	}
})
