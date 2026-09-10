/* global Deno */
/**
 * code-execution 运行护栏（超时 / 大输出截断 / 耗时）单元与集成测试。
 */
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert'
import { available } from 'npm:@steve02081504/exec'

import {
	execShellWithTimeout,
	formatElapsed,
	guardOutput,
	parseRunLimits,
	runJsWithTimeout,
	SHELL_DEFAULT_TIMEOUT_MS,
	truncateOutput,
} from '../../../../../../scripts/shell_guard.mjs'
import { codeExecutionReplyHandler } from '../../../../plugins/code-execution/handler.mjs'
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

Deno.test('codeExecutionReplyHandler truncates large shell output and keeps full content for display', async () => {
	const shell = await pickShell()
	if (!shell) return
	const { logs, result, args } = createHandlerArgs()
	result.content = `<run-${shell}>${commandFor(shell, 'large')}</run-${shell}>`
	result.content_for_handle = result.content
	assertEquals(await codeExecutionReplyHandler(result, args), true)
	const entry = findToolEntry(logs)
	assert(entry, 'tool entry should exist')
	assertEquals(entry.name, `code-execution.run-${shell}`, '每个 shell 应有可区分的工具名')
	assertStringIncludes(entry.content, '完整内容已保存到')
	assertStringIncludes(entry.content, '耗时')
	assert(entry.content_for_show.length > entry.content.length, 'full content should be kept for display')
	assertStringIncludes(entry.content_for_show, commandFor(shell, 'large'), '人类展示层应含执行代码')
	assert(!logs.some(log => log.role === 'char'), 'run 步骤不应再以 char 角色重放（原始生成由管线负责）')
})

Deno.test('codeExecutionReplyHandler reports shell timeout with kill notice', async () => {
	const shell = await pickShell()
	if (!shell) return
	const { logs, result, args } = createHandlerArgs()
	result.content = `<run-${shell} expect="1">${commandFor(shell, 'sleep')}</run-${shell}>`
	result.content_for_handle = result.content
	assertEquals(await codeExecutionReplyHandler(result, args), true)
	const entry = findToolEntry(logs)
	assert(entry, 'tool entry should exist')
	assertStringIncludes(entry.content, '超时')
	assertStringIncludes(entry.content, '已尝试终止')
})

Deno.test('codeExecutionReplyHandler warns that timed-out JS may still be running', async () => {
	const { logs, result, args } = createHandlerArgs()
	result.content = '<run-js expect="1">await new Promise(() => {})</run-js>'
	result.content_for_handle = result.content
	assertEquals(await codeExecutionReplyHandler(result, args), true)
	const entry = findToolEntry(logs)
	assert(entry, 'tool entry should exist')
	assertStringIncludes(entry.content, '无法强制终止')
	assertStringIncludes(entry.content, '仍在后台运行')
})

Deno.test('codeExecutionReplyHandler appends elapsed time on normal completion', async () => {
	const { logs, result, args } = createHandlerArgs()
	result.content = '<run-js>1 + 1</run-js>'
	result.content_for_handle = result.content
	assertEquals(await codeExecutionReplyHandler(result, args), true)
	const entry = findToolEntry(logs)
	assert(entry, 'tool entry should exist')
	assertStringIncludes(entry.content, '耗时')
	assertStringIncludes(entry.content, '2')
	assertStringIncludes(entry.content_for_show, '1 + 1', '人类展示层应含执行代码')
})

Deno.test('codeExecutionReplyHandler writes inline results to content_for_show without rewriting content', async () => {
	const { logs, result, args } = createHandlerArgs()
	const raw = '答案是 <inline-js>1 + 1</inline-js>。'
	result.content = raw
	result.content_for_handle = result.content
	result.content_for_show = `<details class="fount-reasoning-details">思考</details>\n\n${raw}`
	assertEquals(await codeExecutionReplyHandler(result, args), false)
	assert(String(result.content).includes('<inline-js>'), 'content 必须保留原始生成（含标签）')
	assert(!String(result.content_for_show).includes('<inline-js>'), 'content_for_show 中的内联标签应被替换')
	assertStringIncludes(String(result.content_for_show), '2')
	const toolCard = logs.find(log => log.name === 'code-execution.inline-js')
	assert(toolCard, '内联工具卡条目应存在')
	assert(String(toolCard.charVisibility).includes('test-char'), '内联条目应带 charVisibility')
	assertStringIncludes(String(toolCard.content_for_show), '1 + 1')
	assertStringIncludes(String(toolCard.content_for_show), '2')
	assert(!logs.some(log => log.role === 'char'), 'handler 不应以 char 角色重放工具调用')
})

Deno.test('runReplyHandlers 中 run-* 容器被掩除，不会触发内层 inline-js', async () => {
	const { logs, result, args } = createHandlerArgs()
	result.content = '<run-js>const s = "<inline-js>1 + 1</inline-js>"</run-js>'
	result.content_for_handle = result.content
	const wantRegen = await runReplyHandlers(result, args, [codeExecutionReplyHandler])
	assertEquals(wantRegen, true, 'run-* 步骤应建议下一轮生成')
	const toolEntries = logs.filter(log => log.name?.startsWith('code-execution.'))
	assertEquals(toolEntries.length, 1, '只应执行 run-js 步骤，内层 inline-js 不应被触发')
	assertEquals('content_for_handle' in result, false, '管线应清理临时工作副本')
})
