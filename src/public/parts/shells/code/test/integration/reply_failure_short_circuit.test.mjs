/* global Deno */
/**
 * code-execution 工具失败后的同轮短路：失败的 run-* 应阻断同轮后续工具调用。
 */
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert'
import { available } from 'npm:@steve02081504/exec'

import { getCodeExecutionReplyHandlers } from '../../../../plugins/code-execution/handler.mjs'
import { runReplyHandlers } from '../../../chat/src/reply/handlerPipeline.mjs'

/**
 * 选择当前环境可用的 shell。
 * @returns {Promise<string|null>} shell 名。
 */
async function pickShell() {
	const availability = await available
	for (const name of ['pwsh', 'powershell', 'bash', 'sh'])
		if (availability[name]) return name
	return null
}

/**
 * 构造 handler 调用参数，收集回写日志。
 * @returns {{logs: object[], result: object, args: object}} 日志数组、回复对象与参数。
 */
function createHandlerArgs() {
	const logs = []
	/**
	 * 收集工具回写日志。
	 * @param {object} entry - 日志条目。
	 * @returns {void}
	 */
	const addLog = entry => { logs.push(entry) }
	const result = { content: '', extension: {} }
	return {
		logs,
		result,
		args: {
			Charname: 'TestChar',
			char_id: 'test-char',
			username: 'test-user',
			workdir: { machine: '0' },
			chat_log: [],
			chat_scoped_char_memory: {},
			plugins: {},
			supported_functions: {},
			AddLongTimeLog: addLog,
		},
	}
}

Deno.test('code-execution 失败的 run-js 跳过同轮后续调用', async () => {
	const { logs, result, args } = createHandlerArgs()
	result.content = '<run-js>throw new Error("boom")</run-js>\n<run-js>console.log("SHOULD_NOT_RUN"); return 2</run-js>'
	assertEquals(await runReplyHandlers(result, args, getCodeExecutionReplyHandlers()), true)
	const runs = logs.filter(entry => entry.name === 'code-execution.run-js')
	assertEquals(runs.length, 1, '失败后第二个 run-js 不应执行')
	assertStringIncludes(runs[0].content, 'boom')
	const skipped = logs.find(entry => entry.name === 'chat.skipped-calls')
	assert(skipped, '应写入跳过提示')
	assertStringIncludes(skipped.content, 'SHOULD_NOT_RUN')
})

Deno.test('code-execution shell 非零退出标记失败并跳过后续调用', async () => {
	const shell = await pickShell()
	if (!shell) return
	const { logs, result, args } = createHandlerArgs()
	result.content = `<run-${shell}>exit 3</run-${shell}>\n<run-js>return "SHOULD_NOT_RUN"</run-js>`
	await runReplyHandlers(result, args, getCodeExecutionReplyHandlers())
	assert(!logs.some(entry => entry.name === 'code-execution.run-js'), 'shell 失败后不应执行后续 run-js')
	assert(logs.some(entry => entry.name === 'chat.skipped-calls'), '应写入跳过提示')
})
