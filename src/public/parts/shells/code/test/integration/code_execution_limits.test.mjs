/* global Deno */
/**
 * code-execution 运行护栏（超时 / 大输出截断 / 耗时）单元与集成测试。
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert'
import { async_eval } from 'npm:@steve02081504/async-eval'
import { available } from 'npm:@steve02081504/exec'

import {
	createCollectingConsole,
	execShellWithTimeout,
	formatElapsed,
	guardOutput,
	parseRunLimits,
	runJsWithTimeout,
	SHELL_DEFAULT_TIMEOUT_MS,
	truncateOutput,
} from '../../../../../../scripts/shell_guard.mjs'
import { getTask, resetAsyncTaskState, setAsyncToolingEnabled, takePendingNotifications } from '../../../../plugins/async-task/registry.mjs'
import { getCodeExecutionReplyHandlers } from '../../../../plugins/code-execution/handler.mjs'
import { fileOperationsReplyHandlers } from '../../../../plugins/file-operations/handler.mjs'
import { dispatchRemoteStreamOutput, remoteJsStreamScript, remoteShellStreamScript, withRemoteStreamSink } from '../../../../plugins/file-operations/src/remote_stream.mjs'
import { createTargetExecutor } from '../../../../plugins/file-operations/src/target.mjs'
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
 * 生成指定用途的 shell 命令。
 * @param {string} shell - shell 名。
 * @param {'large'|'sleep'} kind - 用途。
 * @returns {string} 命令。
 */
function commandFor(shell, kind) {
	const posix = shell === 'bash' || shell === 'sh'
	if (kind === 'sleep') return posix ? 'sleep 5' : 'Start-Sleep -Seconds 5'
	return posix
		? 'i=0; while [ $i -lt 2000 ]; do printf \'xxxxxxxxxxxxxxxxxxxx\\n\'; i=$((i+1)); done'
		: 'for ($i = 0; $i -lt 2000; $i++) { \'xxxxxxxxxxxxxxxxxxxx\' }'
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

/**
 * 在收集到的日志中查找 code-execution 工具条目。
 * @param {object[]} logs - 日志数组。
 * @returns {object|undefined} 工具条目。
 */
function findToolEntry(logs) {
	return logs.find(entry => entry.name?.startsWith('code-execution'))
}

Deno.test('createCollectingConsole 逐条回调 stdout/stderr 并保留全文', () => {
	const events = []
	const { console: vc, text } = createCollectingConsole((channel, data) => events.push([channel, data]))
	vc.log('hello', 1)
	vc.error('boom')
	assertStringIncludes(text(), 'hello 1')
	assertStringIncludes(text(), 'boom')
	assert(events.some(([channel, data]) => channel === 'stdout' && data.includes('hello 1')), 'stdout 应逐条回调')
	assert(events.some(([channel, data]) => channel === 'stderr' && data.includes('boom')), 'stderr 应逐条回调')
})

Deno.test('target execShell onOutput 逐块回显（本机）', async () => {
	const shell = await pickShell()
	if (!shell) return
	const executor = createTargetExecutor('test-user', { machine: '0' })
	const chunks = []
	const posix = shell === 'bash' || shell === 'sh'
	const command = posix ? 'printf "hello-stream\\n"' : 'Write-Output \'hello-stream\''
	const result = await executor.execShell(shell, command, {
		/**
		 * 收集输出分片。
		 * @param {'stdout'|'stderr'} stream - 输出通道。
		 * @param {string} data - 分片文本。
		 * @returns {number} 数组新长度。
		 */
		onOutput: (stream, data) => chunks.push([stream, data]),
	})
	assertStringIncludes(String(result.stdall), 'hello-stream')
	assert(chunks.some(([stream, data]) => stream === 'stdout' && data.includes('hello-stream')), '应流式收到 stdout')
})

Deno.test('withRemoteStreamSink/dispatchRemoteStreamOutput 按 execId 分派', async () => {
	const got = []
	await withRemoteStreamSink('exec-a', (stream, data) => got.push([stream, data]), async () => {
		dispatchRemoteStreamOutput({ execId: 'exec-a', stream: 'stdout', data: 'hello' })
		dispatchRemoteStreamOutput({ execId: 'exec-b', stream: 'stderr', data: 'ignored' })
		dispatchRemoteStreamOutput({ execId: 'exec-a', stream: 'stderr', data: 'oops' })
	})
	assertEquals(got, [['stdout', 'hello'], ['stderr', 'oops']])
	dispatchRemoteStreamOutput({ execId: 'exec-a', stream: 'stdout', data: 'after' })
	assertEquals(got.length, 2, '注销后不应再分派')
})

Deno.test('remoteShellStreamScript 在分机侧流式回传并返回结果', async () => {
	const shell = await pickShell()
	if (!shell) return
	const chunks = []
	const posix = shell === 'bash' || shell === 'sh'
	const command = posix ? 'echo remote-stream' : 'Write-Output \'remote-stream\''
	const script = remoteShellStreamScript(shell, command, undefined, null, 'exec-test')
	const evalResult = await async_eval(script, {
		/**
		 * 收集回调分片。
		 * @param {object} payload - 回调负载。
		 * @returns {number} 数组新长度。
		 */
		callback: payload => chunks.push(payload),
	})
	if (evalResult.error) throw evalResult.error
	assertStringIncludes(String(evalResult.result.stdall), 'remote-stream')
	assert(chunks.some(chunk => chunk.execId === 'exec-test' && chunk.stream === 'stdout' && chunk.data.includes('remote-stream')), '应流式回传 stdout')
})

Deno.test('remoteShellStreamScript 超时杀掉分机侧进程树并标记 timedOut', async () => {
	const shell = await pickShell()
	if (!shell) return
	const posix = shell === 'bash' || shell === 'sh'
	// 超时必须显著大于 shell 冷启动 + 嵌套 async_eval 加载 npm 模块的耗时（实测空闲 ~0.5s，整机负载下可达数秒）。
	// 若超时贴得太紧（如 800ms），它会在 "before" 输出之前就触发，使 "before" 断言随机失败（racy）。
	// 内层 sleep 远大于超时，保证 "after" 永不产生。
	const command = posix
		? `printf before; ${shell} -c 'sleep 120; printf after'`
		: `Write-Output before; ${shell} -NoProfile -Command 'Start-Sleep -Seconds 120; Write-Output after'`
	const chunks = []
	const script = remoteShellStreamScript(shell, command, undefined, 8000, 'exec-timeout')
	const start = Date.now()
	const evalResult = await async_eval(script, {
		/**
		 * 收集回调分片。
		 * @param {object} payload - 回调负载。
		 * @returns {number} 数组新长度。
		 */
		callback: payload => chunks.push(payload),
	})
	const elapsed = Date.now() - start
	const outcome = evalResult.error ?? evalResult.result
	assertEquals(outcome?.timedOut, true, '应标记 timedOut')
	assert(elapsed < 20_000, `应于超时后迅速收敛（实际 ${elapsed}ms）`)
	await new Promise(resolve => setTimeout(resolve, 1000))
	const text = chunks.map(chunk => String(chunk.data)).join('')
	assertStringIncludes(text, 'before')
	assert(!text.includes('after'), '超时杀进程树后不应再收到后续输出')
})

Deno.test('remoteJsStreamScript 在分机侧流式回传 console 输出并保留返回值', async () => {
	const chunks = []
	const script = remoteJsStreamScript('console.log("remote-js", 1); return 5', 'js-test')
	const evalResult = await async_eval(script, {
		/**
		 * 收集回调分片。
		 * @param {object} payload - 回调负载。
		 * @returns {number} 数组新长度。
		 */
		callback: payload => chunks.push(payload),
	})
	if (evalResult.error) throw evalResult.error
	assertEquals(evalResult.result, 5)
	assert(chunks.some(chunk => chunk.execId === 'js-test' && chunk.data.includes('remote-js 1')), '应流式回传 console 输出')
})

Deno.test('code-execution run-js 实时转发 console 输出', async () => {
	const { result, args } = createHandlerArgs()
	const events = []
	args.generation_options = {
		/**
		 * 收集工具输出事件。
		 * @param {object} event - 工具输出事件。
		 * @returns {number} 数组新长度。
		 */
		onToolOutput: event => events.push(event),
	}
	result.content = '<run-js>console.log("流式输出", 42); return 7</run-js>'
	assertEquals(await runReplyHandlers(result, args, getCodeExecutionReplyHandlers()), true)
	assert(events.some(event => event.phase === 'start' && event.lang === 'js' && event.code.includes('console.log')), '应发 start 事件')
	assert(events.some(event => event.phase === 'chunk' && event.stream === 'stdout' && event.data.includes('流式输出 42')), '应转发 console 输出')
	assert(events.some(event => event.phase === 'end'), '应发 end 事件')
	assertEquals(new Set(events.map(event => event.callId)).size, 1, '同一调用应共用 callId')
})

Deno.test('code-execution run-js async="true" 登记统一异步任务并投递完成通知', async () => {
	resetAsyncTaskState()
	setAsyncToolingEnabled(true)
	try {
		const { logs, result, args } = createHandlerArgs()
		args.chat_name = 'code-test'
		result.content = '<run-js async="true">console.log("async-output"); return 21 * 2</run-js>'
		assertEquals(await runReplyHandlers(result, args, getCodeExecutionReplyHandlers()), true)
		const dispatch = logs.find(entry => entry.name === 'code-execution.async')
		assert(dispatch, '应写异步派发回执')
		const id = dispatch.extension?.asyncTask?.id
		assert(id, '回执应携带统一异步任务 id')

		const deadline = Date.now() + 3000
		while (getTask(id) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
		assertEquals(getTask(id), undefined, '任务完成后应从注册表移除')
		const notes = takePendingNotifications({ username: 'test-user', charId: 'test-char', chatName: 'code-test', parentRunId: null })
		assert(notes.some(note => note.content.includes('output:') && note.content.includes('async-output') && note.content.includes('result: 42')), '应投递包含输出与结果的完成通知')
	}
	finally {
		setAsyncToolingEnabled(false)
		resetAsyncTaskState()
	}
})

Deno.test('code-execution run-* 实时转发 shell 输出', async () => {
	const shell = await pickShell()
	if (!shell) return
	const { result, args } = createHandlerArgs()
	const events = []
	args.generation_options = {
		/**
		 * 收集工具输出事件。
		 * @param {object} event - 工具输出事件。
		 * @returns {number} 数组新长度。
		 */
		onToolOutput: event => events.push(event),
	}
	const posix = shell === 'bash' || shell === 'sh'
	const command = posix ? 'echo streamed-line' : 'Write-Output \'streamed-line\''
	result.content = `<run-${shell}>${command}</run-${shell}>`
	assertEquals(await runReplyHandlers(result, args, getCodeExecutionReplyHandlers()), true)
	assert(events.some(event => event.phase === 'start' && event.lang === shell), '应发 start 事件')
	assert(events.some(event => event.phase === 'chunk' && event.data.includes('streamed-line')), '应转发 shell 输出')
	assert(events.some(event => event.phase === 'end'), '应发 end 事件')
})

Deno.test('code-execution inline-js 实时转发 console 输出', async () => {
	const { result, args } = createHandlerArgs()
	const events = []
	args.generation_options = {
		/**
		 * 收集工具输出事件。
		 * @param {object} event - 工具输出事件。
		 * @returns {number} 数组新长度。
		 */
		onToolOutput: event => events.push(event),
	}
	result.content = '结果是 <inline-js>console.log("内联输出"); 1 + 1</inline-js>'
	await runReplyHandlers(result, args, getCodeExecutionReplyHandlers())
	assert(events.some(event => event.phase === 'start' && event.lang === 'js'), '应发 start 事件')
	assert(events.some(event => event.phase === 'chunk' && event.data.includes('内联输出')), '应转发内联 console 输出')
	assert(events.some(event => event.phase === 'end'), '应发 end 事件')
})

Deno.test('parseRunLimits: defaults, expect+tolerance, suffixes, wait forever', () => {
	assertEquals(parseRunLimits({}).timeoutMs, SHELL_DEFAULT_TIMEOUT_MS)
	assertEquals(parseRunLimits({}, 60_000).timeoutMs, 60_000)
	assertEquals(parseRunLimits({ expect: '5m', tolerance: '1m' }).timeoutMs, 360_000)
	assertEquals(parseRunLimits({ tolerance: '30s' }).timeoutMs, SHELL_DEFAULT_TIMEOUT_MS + 30_000)
	assertEquals(parseRunLimits({ expect: '1.5s' }).timeoutMs, 1500)
	assertEquals(parseRunLimits({ wait: 'forever' }).timeoutMs, null)
	assertEquals(parseRunLimits({ timeout: 'none' }).timeoutMs, null)
	assertEquals(parseRunLimits({ 'no-timeout': 'true' }).timeoutMs, null)
	assertEquals(parseRunLimits({ expect: 'bogus' }).timeoutMs, SHELL_DEFAULT_TIMEOUT_MS)
})

Deno.test('truncateOutput keeps head and tail', () => {
	const text = 'A'.repeat(30_000)
	const result = truncateOutput(text)
	assertEquals(result.truncated, true)
	assert(result.text.length < text.length)
	assertStringIncludes(result.text, 'A'.repeat(100))
	assertEquals(result.omitted, 30_000 - 8000 - 8000)
	assertEquals(truncateOutput('short').truncated, false)
})

Deno.test('guardOutput writes full content to a temp file when oversized', async () => {
	const result = await guardOutput('B'.repeat(30_000), { name: 'unit-test' })
	assertEquals(result.truncated, true)
	assert(result.savedPath, 'savedPath should be set')
	assertStringIncludes(result.text, result.savedPath)
})

Deno.test('formatElapsed formats ms and seconds', () => {
	assertEquals(formatElapsed(500), '500ms')
	assertEquals(formatElapsed(1500), '1.50s')
	assertEquals(formatElapsed(0), '0ms')
})

Deno.test('runJsWithTimeout returns value with elapsed and times out on a pending promise', async () => {
	const ok = await runJsWithTimeout(async () => ({ result: 7 }), 2000)
	assertEquals(ok.evalResult.result, 7)
	assertEquals(ok.timedOut, false)
	assert(ok.elapsedMs >= 0)

	const hang = await runJsWithTimeout(() => new Promise(() => { }), 300)
	assertEquals(hang.timedOut, true)
	assertEquals(hang.evalResult, null)
})

Deno.test('execShellWithTimeout kills a process tree on timeout', async () => {
	const shell = await pickShell()
	if (!shell) return
	const start = Date.now()
	const result = await execShellWithTimeout(shell, commandFor(shell, 'sleep'), { no_ansi_terminal_sequences: true }, 1000)
	assertEquals(result.timedOut, true)
	assert(Date.now() - start < 10_000, 'should return promptly after kill')
})

Deno.test('code-execution run-* 截断大 shell 输出并保留完整展示', async () => {
	const shell = await pickShell()
	if (!shell) return
	const { logs, result, args } = createHandlerArgs()
	result.content = `<run-${shell}>${commandFor(shell, 'large')}</run-${shell}>`
	assertEquals(await runReplyHandlers(result, args, getCodeExecutionReplyHandlers()), true)
	const entry = findToolEntry(logs)
	assert(entry, 'tool entry should exist')
	assertEquals(entry.name, `code-execution.run-${shell}`, '每个 shell 应有可区分的工具名')
	assertStringIncludes(entry.content, '完整内容已保存到')
	assertStringIncludes(entry.content, '耗时')
	assert(entry.content_for_show.length > entry.content.length, 'full content should be kept for display')
	assertStringIncludes(entry.content_for_show, commandFor(shell, 'large'), '人类展示层应含执行代码')
	assert(!logs.some(log => log.role === 'char'), 'run 步骤不应再以 char 角色重放（原始生成由管线负责）')
})

Deno.test('code-execution run-* 报告超时与终止提示', async () => {
	const shell = await pickShell()
	if (!shell) return
	const { logs, result, args } = createHandlerArgs()
	result.content = `<run-${shell} expect="1">${commandFor(shell, 'sleep')}</run-${shell}>`
	assertEquals(await runReplyHandlers(result, args, getCodeExecutionReplyHandlers()), true)
	const entry = findToolEntry(logs)
	assert(entry, 'tool entry should exist')
	assertStringIncludes(entry.content, '超时')
	assertStringIncludes(entry.content, '已尝试终止')
})

Deno.test('code-execution run-js 提示超时 JS 可能仍在运行', async () => {
	const { logs, result, args } = createHandlerArgs()
	result.content = '<run-js expect="1">await new Promise(() => {})</run-js>'
	assertEquals(await runReplyHandlers(result, args, getCodeExecutionReplyHandlers()), true)
	const entry = findToolEntry(logs)
	assert(entry, 'tool entry should exist')
	assertStringIncludes(entry.content, '无法强制终止')
	assertStringIncludes(entry.content, '仍在后台运行')
})

Deno.test('code-execution run-js 正常完成附耗时与结果', async () => {
	const { logs, result, args } = createHandlerArgs()
	result.content = '<run-js>1 + 1</run-js>'
	assertEquals(await runReplyHandlers(result, args, getCodeExecutionReplyHandlers()), true)
	const entry = findToolEntry(logs)
	assert(entry, 'tool entry should exist')
	assertStringIncludes(entry.content, '耗时')
	assertStringIncludes(entry.content, '2')
	assertStringIncludes(entry.content_for_show, '1 + 1', '人类展示层应含执行代码')
})

Deno.test('code-execution run-js 将 console 和返回值归为 output/result，错误归为 output/error', async () => {
	for (const [code, expected] of [
		['console.log("hello", 42); return { answer: 42 }', ['output:', 'hello 42', 'result:', 'answer: 42']],
		['console.log("before error"); throw new Error("failed")', ['output:', 'before error', 'error:', 'failed']],
	]) {
		const { logs, result, args } = createHandlerArgs()
		result.content = `<run-js>${code}</run-js>`
		assertEquals(await runReplyHandlers(result, args, getCodeExecutionReplyHandlers()), true)
		const entry = findToolEntry(logs)
		for (const part of expected) assertStringIncludes(entry.content, part)
		assertStringIncludes(entry.content_for_show, '```ansi', '展示层应以 ansi 代码块渲染结果/错误（前端转义着 color，不经 markdown）')
		assert(!entry.content.includes('outputEntries'), '不应向模型展开 EvalResult 内部结构')
		assert(!entry.content.includes('LogEntry'), '不应向模型展开 console 日志对象')
	}
})

Deno.test('code-execution run-js 把不可信结果包进 ansi 代码块，不按 markdown/HTML 解析', async () => {
	const { logs, result, args } = createHandlerArgs()
	result.content = '<run-js>return \'<img src=x onerror="alert(1)">\' + String.fromCharCode(10) + \'[x](javascript:alert(2))\'</run-js>'
	assertEquals(await runReplyHandlers(result, args, getCodeExecutionReplyHandlers()), true)
	const entry = findToolEntry(logs)
	assert(entry, 'tool entry should exist')
	assertStringIncludes(entry.content_for_show, '```ansi', '结果应包进 ansi 代码块')
	const fenced = entry.content_for_show.split('```ansi')[1] ?? ''
	assert(fenced.includes('<img src=x onerror='), '不可信原文应位于代码块内，交由前端 ansi2html 转义')
})

Deno.test('code-execution inline-js 结果就地替换展示层且不改 content', async () => {
	const { logs, result, args } = createHandlerArgs()
	const raw = '答案是 <inline-js>1 + 1</inline-js>。'
	result.content = raw
	result.content_for_show = `<details class="fount-reasoning-details">思考</details>\n\n${raw}`
	assertEquals(await runReplyHandlers(result, args, getCodeExecutionReplyHandlers()), false)
	assert(String(result.content).includes('<inline-js>'), 'content 必须保留原始生成（含标签）')
	assert(!String(result.content_for_show).includes('<inline-js>'), 'content_for_show 中的内联标签应被替换')
	assertStringIncludes(String(result.content_for_show), '2')
	const toolCard = logs.find(log => log.name === 'code-execution.inline-js')
	assert(toolCard, '内联工具卡条目应存在')
	assert(String(toolCard.charVisibility).includes('test-char'), '内联条目应带 charVisibility')
	assertStringIncludes(String(toolCard.content_for_show), '1 + 1')
	assertStringIncludes(String(toolCard.content_for_show), '2')
	assert(!logs.some(log => log.role === 'char'), 'handler 不应以 char 角色重放工具调用')
	assertStringIncludes(toolCard.content, '2', '角色应直接在内联工具卡回执中拿到结果')
	assert(!logs.some(log => log.name === 'inline-rendered'), '已在工具回执包含结果时无需第二份汇总')
})

Deno.test('code-execution run-js/inline-js 暴露工作目录的绝对路径变量 workdir', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_js_workdir_'))
	try {
		const run = createHandlerArgs()
		run.args.workdir = { machine: '0', path: root }
		await runReplyHandlers({ content: '<run-js>return typeof workdir</run-js>', extension: {} }, run.args, getCodeExecutionReplyHandlers())
		const entry = findToolEntry(run.logs)
		assert(entry, 'run-js 应产出工具日志')
		assertStringIncludes(entry.content, '\'string\'', 'run-js 应在上下文中注入 workdir 字符串')

		const inline = createHandlerArgs()
		inline.args.workdir = { machine: '0', path: root }
		const handlers = getCodeExecutionReplyHandlers()
		const inlineJs = handlers.find(handler => handler.name === 'inline-js')
		const call = { name: 'inline-js', inner: 'workdir', params: {}, occurrence: 0 }
		const evaluated = await inlineJs.evaluate(call, inline.args)
		assertEquals(evaluated, root, 'inline-js 也应拿到同一个 workdir 绝对路径')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('code-execution run-js 无工作目录时不注入 workdir', async () => {
	const { logs, args } = createHandlerArgs()
	await runReplyHandlers({ content: '<run-js>return typeof workdir</run-js>', extension: {} }, args, getCodeExecutionReplyHandlers())
	const entry = findToolEntry(logs)
	assertStringIncludes(entry.content, 'undefined', '未指定工作目录时不应注入 workdir')
})

Deno.test('runReplyHandlers 中 run-* 容器整段消耗，不触发内层 inline-js', async () => {
	const { logs, result, args } = createHandlerArgs()
	result.content = '<run-js>const s = "<inline-js>1 + 1</inline-js>"</run-js>'
	const wantRegen = await runReplyHandlers(result, args, getCodeExecutionReplyHandlers())
	assertEquals(wantRegen, true, 'run-* 步骤应建议下一轮生成')
	const toolEntries = logs.filter(log => log.name?.startsWith('code-execution.'))
	assertEquals(toolEntries.length, 1, '只应执行 run-js 步骤，内层 inline-js 不应被触发')
})

Deno.test('融合调用：跨插件工具按生成文本顺序依次执行后再重新生成', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_fused_calls_'))
	try {
		await fs.writeFile(path.join(root, 'f.txt'), 'alpha\n', 'utf8')
		const { logs, result, args } = createHandlerArgs()
		args.workdir = { machine: '0', path: root }
		args.prompt_struct = { char_prompt: { additional_chat_log: [] } }
		result.logContextBefore = []
		result.content = [
			'<replace-file><file path="f.txt"><replacement><search>alpha</search><replace>beta</replace></replacement></file></replace-file>',
			'<run-js>1 + 1</run-js>',
			'<override-file path="g.txt">gamma</override-file>',
		].join('\n')
		// 故意把 code-execution 排在 file-operations 之前，验证管线改按生成文本顺序调度
		const wantRegen = await runReplyHandlers(result, args, [...fileOperationsReplyHandlers, ...getCodeExecutionReplyHandlers()])
		assertEquals(wantRegen, true, '全部工具执行完后应统一建议重新生成')
		assertEquals(
			logs.map(entry => entry.name),
			['file-operations.replace-file', 'code-execution.run-js', 'file-operations.override-file'],
			'执行顺序应跟随生成文本，而非 handler 声明顺序',
		)
		assertEquals(await fs.readFile(path.join(root, 'f.txt'), 'utf8'), 'beta\n')
		assertStringIncludes(await fs.readFile(path.join(root, 'g.txt'), 'utf8'), 'gamma')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})
