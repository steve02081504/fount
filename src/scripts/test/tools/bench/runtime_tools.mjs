/* global Deno */
/* eslint jsdoc/require-jsdoc: off */
/** code-execution 与 sub-agent 运行时路径的本地基准。 */
import { performance } from 'node:perf_hooks'

import { awaitTasks, ownerFromArgs, resetAsyncTaskState } from 'fount/public/parts/plugins/async-task/registry.mjs'
import { getCodeExecutionReplyHandlers } from 'fount/public/parts/plugins/code-execution/handler.mjs'
import { runSubAgent } from 'fount/public/parts/plugins/sub-agent/runtime.mjs'
import { resetSubAgentState } from 'fount/public/parts/plugins/sub-agent/state.mjs'
import { runReplyHandlers } from 'fount/public/parts/shells/chat/src/reply/handlerPipeline.mjs'

const allowedArgs = new Set(['iterations', 'output'])
const options = new Map()
for (const value of Deno.args) {
	const match = value.match(/^--([^=]+)=(.*)$/)
	if (!match || !allowedArgs.has(match[1]) || options.has(match[1])) throw new Error(`Invalid or duplicate option: ${value}`)
	options.set(match[1], match[2])
}
const iterations = Number(options.get('iterations') ?? 9)
if (!Number.isInteger(iterations) || iterations <= 0) throw new Error('--iterations must be a positive integer')
const warmups = 2

const outputBytes = value => new TextEncoder().encode(String(value ?? '')).byteLength
const shellName = Deno.build.os === 'windows' ? 'powershell' : 'sh'
const handlers = getCodeExecutionReplyHandlers({ resolveShells: async () => [shellName] })
const savedInfo = console.info

/**
 * 让一个 code-execution 标签走正常的 reply-handler 流水线。
 * @param {string} tag - 工具标签。
 * @param {string} code - 标签正文。
 * @returns {Promise<object>} 收集到的工具结果。
 */
async function executeTool(tag, code) {
	const logs = []
	const reply = { content: `<${tag}>${code}</${tag}>`, extension: {} }
	const args = {
		Charname: 'BenchChar', username: 'runtime-bench', char_id: 'runtime-bench-char', chat_name: 'runtime-bench',
		workdir: { machine: '0', path: Deno.cwd() }, chat_log: [], plugins: {}, supported_functions: {}, chat_scoped_char_memory: {},
		AddLongTimeLog: entry => logs.push(entry),
	}
	await runReplyHandlers(reply, args, handlers)
	const text = logs.map(entry => entry.content ?? '').join('\n')
	return { text, logs, reply, failed: logs.some(entry => entry.extension?.error) }
}

/**
 * 确定性的假 AI 源。
 * @param {number} rounds - 模型轮数。
 * @returns {object} 假源与计数器。
 */
function fakeAi(rounds) {
	let calls = 0
	return {
		filename: 'runtime-benchmark-fake-ai.mjs',
		callCount: 0, inputBytes: 0, outputBytes: 0,
		async Call() { return 'fake summary' },
		async StructCall(prompt, options) {
			this.callCount++
			this.inputBytes += outputBytes(JSON.stringify(prompt))
			const content = calls++ < rounds - 1 ? '<bench-regen/>' : 'BENCHMARK-FINAL'
			this.outputBytes += outputBytes(content)
			options.base_result.content = content
			return { content }
		},
	}
}

/**
 * 构造隔离的、注入式 sub-agent 依赖。
 * @param {number} rounds - 重生成轮数。
 * @returns {object} 依赖与观测记录。
 */
function fakeDeps(rounds) {
	const records = []
	const notifications = []
	const ai = fakeAi(rounds)
	let handlerCalls = 0
	const toolPlugin = { interfaces: { chat: { ReplyHandler: { name: 'bench-regen', level: 0, handle: async () => handlerCalls++ < rounds - 1 ? { regen: true } : {} } } } }
	return {
		records, notifications,
		loadPart: async (name, partpath) => partpath.endsWith('sub-agent') ? toolPlugin : { interfaces: { chat: {} } },
		loadAnyPreferredDefaultPart: async () => ai,
		listAiSources: async () => [],
		recordGeneration: async (name, record) => { records.push(record) },
		notifyRun: async (name, event) => { notifications.push(event) },
		buildPromptStruct: async args => ({
			char_prompt: { text: [], additional_chat_log: [], extension: {} }, user_prompt: { text: [], additional_chat_log: [], extension: {} },
			world_prompt: { text: [], additional_chat_log: [], extension: {} }, other_chars_prompts: {}, other_personas_prompts: {},
			chat_log: [...args.chat_log ?? []], plugin_prompts: {}, timelines: [], locales: args.locales,
		}),
		runReplyHandlers,
		archive: {
			projectArchiveEntries: () => [], writeParentArchive: () => null,
			removeParentArchive: () => {}, cleanupExpiredArchives: () => 0,
		},
		now: () => Date.now(), isStopping: () => false, ai,
	}
}

/** @returns {object} runSubAgent 需要的父请求。 */
function parentArgs() {
	return {
		chat_name: 'runtime-bench', char_id: 'runtime-bench-char', username: 'runtime-bench-user', Charname: 'Bench', UserCharname: 'User',
		CharUid: 'bench-char-uid', UserUid: 'bench-user-uid', supported_functions: {},
		chat_log: [{ role: 'user', uid: 'bench-user-uid', name: 'User', content: 'benchmark task', time_stamp: 0 }],
		timelines: [], locales: ['en-UK'], plugins: {}, chat_scoped_char_memory: {}, workdir: { machine: '0', path: Deno.cwd() }, extension: {},
	}
}

function percentile(sorted, fraction) { return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] }

/**
 * 计时并在计时后校验结果。
 * @param {string} name - 用例名。
 * @param {() => Promise<object>} operation - 被测操作。
 * @param {(result: object) => void|Promise<void>} check - 正确性校验。
 * @returns {Promise<object>} 统计结果。
 */
async function measure(name, operation, check) {
	const samples = []
	let result
	let start = performance.now()
	result = await operation()
	const coldMs = performance.now() - start
	await check(result)
	for (let i = 0; i < warmups + iterations; i++) {
		start = performance.now()
		result = await operation()
		const elapsed = performance.now() - start
		await check(result)
		if (i >= warmups) samples.push(elapsed)
	}
	const sorted = [...samples].sort((a, b) => a - b)
	return {
		name, iterations, coldMs: +coldMs.toFixed(3), warmMedianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(3),
		warmP95Ms: +percentile(sorted, .95).toFixed(3), outputBytes: outputBytes(result?.text ?? result?.response ?? ''),
		...result?.model ? { modelCalls: result.model.callCount, modelInputBytes: result.model.inputBytes, modelOutputBytes: result.model.outputBytes } : {},
	}
}

/**
 * 用假 AI 与空实现的持久化/通知测量一次真实的 runSubAgent。
 * @param {number} rounds - 重生成轮数。
 * @param {boolean} asyncRun - 是否走异步模式。
 * @returns {Promise<object>} 完成结果。
 */
async function runSubAgentCase(rounds, asyncRun) {
	resetSubAgentState()
	resetAsyncTaskState()
	const deps = fakeDeps(rounds)
	try {
		const outcome = await runSubAgent(parentArgs(), { body: 'benchmark task', roundLimit: rounds + 2, timeLimitMs: 60_000, async: asyncRun }, deps)
		if (asyncRun) {
			const settled = await awaitTasks([outcome.backgroundId], { requester: ownerFromArgs(parentArgs()) })
			if (settled.pending.length || settled.settled[0]?.state !== 'done') throw new Error('async sub-agent did not complete')
			return { response: deps.records[0]?.response, run: outcome.run, records: deps.records, model: deps.ai }
		}
		return { response: outcome.text, run: outcome.run, records: deps.records, model: deps.ai }
	} finally {
		resetSubAgentState()
		resetAsyncTaskState()
	}
}

try {
	console.info = () => {}
	const results = []
	results.push(await measure('run-js-short', () => executeTool('run-js', 'return 6 * 7'), result => {
		if (result.failed || !result.text.includes('42')) throw new Error('run-js result check failed')
	}))
	const shellCommand = shellName === 'powershell' ? 'Write-Output \'SHELL-OK\'' : 'printf \'SHELL-OK\\n\''
	results.push(await measure('shell-short', () => executeTool(`run-${shellName}`, shellCommand), result => {
		if (result.failed || !result.text.includes('退出码 0') || !result.text.includes('SHELL-OK')) throw new Error('shell result check failed')
	}))
	const separateCommands = ['BATCH-1', 'BATCH-2', 'BATCH-3'].map(value => shellName === 'powershell' ? `Write-Output '${value}'` : `printf '${value}\\n'`)
	const batchCommand = shellName === 'powershell'
		? 'Write-Output \'BATCH-1\'; Write-Output \'BATCH-2\'; Write-Output \'BATCH-3\''
		: 'printf \'BATCH-1\\n\'; printf \'BATCH-2\\n\'; printf \'BATCH-3\\n\''
	results.push(await measure('shell-three-separate-calls', async () => {
		const parts = []
		for (const command of separateCommands) parts.push(await executeTool(`run-${shellName}`, command))
		return {
			text: parts.map(part => part.text).join('\n'), logs: parts.flatMap(part => part.logs),
			failed: parts.some(part => part.failed || !part.text.includes('退出码 0')),
		}
	}, result => {
		if (result.failed || !result.text.includes('退出码 0')) throw new Error('separate shell execution failed')
		for (const value of ['BATCH-1', 'BATCH-2', 'BATCH-3']) if (!result.text.includes(value)) throw new Error('separate shell result check failed')
	}))
	results.push(await measure('shell-three-command-batch', () => executeTool(`run-${shellName}`, batchCommand), result => {
		if (result.failed || !result.text.includes('退出码 0')) throw new Error('batch shell execution failed')
		for (const value of ['BATCH-1', 'BATCH-2', 'BATCH-3']) if (!result.text.includes(value)) throw new Error('batch shell result check failed')
	}))
	const largeOutputCommand = shellName === 'powershell'
		? '[Console]::Write(\'X\' * 16000)'
		: 'head -c 16000 /dev/zero | tr \'\\0\' X'
	results.push(await measure('shell-output-16k', () => executeTool(`run-${shellName}`, largeOutputCommand), result => {
		if (result.failed || !result.text.includes('退出码 0') || !result.text.includes('X'.repeat(1000))) throw new Error('large shell output check failed')
	}))
	for (const rounds of [1, 3])
		for (const asyncRun of [false, true]) {
			const mode = asyncRun ? 'async' : 'sync'
			results.push(await measure(`subagent-${mode}-${rounds}-rounds`, () => runSubAgentCase(rounds, asyncRun), result => {
				if (result.response !== 'BENCHMARK-FINAL' || result.run.rounds !== rounds || result.model.callCount !== rounds) throw new Error(`sub-agent ${mode}/${rounds} correctness check failed`)
			}))
		}

	const json = JSON.stringify({ schema: 1, generatedAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, node: process.version, deno: Deno.version, iterations, warmups, shell: shellName, mockAi: true, results }, null, 2)
	if (options.has('output')) await Deno.writeTextFile(options.get('output'), `${json}\n`)
	else console.log(json)
} finally {
	console.info = savedInfo
	resetSubAgentState()
	resetAsyncTaskState()
}
