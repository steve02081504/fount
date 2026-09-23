/* global Deno */
/**
 * sub-agent 生成循环集成测试：用注入的假 AI 源与假插件验证同步/异步运行、层级轮次传播、超限摘要、深度与限额校验。
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert'

import { runReplyHandlers } from '../../../../shells/chat/src/reply/handlerPipeline.mjs'
import { awaitTasks, finishAsyncGeneration, inspectTask, ownerFromArgs, resetAsyncTaskState, setAsyncTaskNotifier } from '../../../async-task/registry.mjs'
import { runSubAgent, SubAgentError } from '../../runtime.mjs'
import { createRun, getRun, resetSubAgentState } from '../../state.mjs'

/**
 * 假 AI 源：逐轮返回脚本内容（写入 base_result），摘要时返回固定文本。
 * @param {string[]} script 每轮生成内容
 * @param {string} [summary] 摘要文本
 * @returns {object} 假 AI 源
 */
function createFakeAi(script, summary = 'FINAL-SUMMARY') {
	let index = 0
	return {
		filename: 'fake-ai.mjs',
		summaryCalls: 0,
		/**
		 * 纯文本摘要调用。
		 * @returns {Promise<string>} 摘要文本
		 */
		async Call() {
			this.summaryCalls++
			return summary
		},
		/**
		 * 结构化调用：把脚本内容写入 base_result。
		 * @param {object} _prompt 提示结构
		 * @param {object} options 生成选项
		 * @returns {Promise<object>} 生成结果
		 */
		async StructCall(_prompt, options) {
			const content = script[Math.min(index, script.length - 1)]
			index++
			options.base_result.content = content
			return { content }
		},
	}
}

/**
 * 阻塞型假 AI 源：`StructCall` 写入内容后等待手动放行，用于在运行中检视。
 * @param {string} [content] 生成内容
 * @returns {{ai: object, release: () => void}} 假 AI 源与放行器
 */
function createBlockingAi(content = 'partial-result') {
	/** @type {() => void} */
	let release = () => { }
	const gate = new Promise(resolve => { release = resolve })
	return {
		/**
		 * 放行被阻塞的生成。
		 * @returns {void}
		 */
		release: () => release(),
		ai: {
			filename: 'blocking-ai.mjs',
			summaryCalls: 0,
			/**
			 * 纯文本摘要调用。
			 * @returns {Promise<string>} 摘要文本
			 */
			async Call() { this.summaryCalls++; return 'SUMMARY' },
			/**
			 * 结构化调用：写入内容后阻塞直到放行。
			 * @param {object} _prompt 提示结构
			 * @param {object} options 生成选项
			 * @returns {Promise<object>} 生成结果
			 */
			async StructCall(_prompt, options) {
				options.base_result.content = content
				await gate
				return { content }
			},
		},
	}
}

/**
 * 假插件：内容型 handler 在前 N 轮请求重新生成，并可选地观察/改写 handler 参数。
 * @param {number} regenTimes 重新生成次数
 * @param {(args: object) => void} [onHandle] 每次处理时的回调
 * @returns {object} 假插件
 */
function createRegenPlugin(regenTimes, onHandle) {
	let calls = 0
	return {
		interfaces: {
			chat: {
				ReplyHandler: {
					name: 'fake-tool',
					level: 0,
					/**
					 * 内容型 handler。
					 * @param {object} _reply 回复对象
					 * @param {object} args 请求上下文
					 * @returns {Promise<object>} 结果
					 */
					handle: async (_reply, args) => {
						calls++
						onHandle?.(args)
						return calls <= regenTimes ? { regen: true } : {}
					},
				},
			},
		},
	}
}

/**
 * 构造注入依赖。
 * @param {object} aiSource 假 AI 源
 * @param {object} plugin 假插件
 * @returns {object} deps
 */
function createDeps(aiSource, plugin) {
	/** 捕获的生成记录。 */
	const records = []
	/** 捕获的运行状态推送。 */
	const notifications = []
	return {
		records,
		notifications,
		/**
		 * 仅 sub-agent 返回带 handler 的假插件。
		 * @param {string} _username 用户
		 * @param {string} partpath 部件路径
		 * @returns {Promise<object>} 插件
		 */
		loadPart: async (_username, partpath) =>
			partpath.endsWith('sub-agent') ? plugin : { interfaces: { chat: {} } },
		/**
		 * 默认 AI 源。
		 * @returns {Promise<object>} 假 AI 源
		 */
		loadAnyPreferredDefaultPart: async () => aiSource,
		/**
		 * AI 源枚举。
		 * @returns {Promise<object[]>} 空列表
		 */
		listAiSources: async () => [],
		/**
		 * 捕获生成历史（正常流程为落盘）。
		 * @param {string} _username 用户
		 * @param {object} record 记录
		 * @returns {Promise<void>}
		 */
		recordGeneration: async (_username, record) => { records.push(record) },
		/**
		 * 捕获运行状态推送。
		 * @param {string} _username 用户
		 * @param {object} payload 状态摘要
		 * @returns {Promise<void>}
		 */
		notifyRun: async (_username, payload) => { notifications.push(payload) },
		/**
		 * 最小提示结构（避免拉起真实角色图）。
		 * @param {object} args 子请求
		 * @returns {Promise<object>} 提示结构
		 */
		buildPromptStruct: async args => ({
			char_prompt: { text: [], additional_chat_log: [], extension: {} },
			user_prompt: { text: [], additional_chat_log: [], extension: {} },
			world_prompt: { text: [], additional_chat_log: [], extension: {} },
			other_chars_prompts: {},
			other_personas_prompts: {},
			chat_log: args.chat_log,
			plugin_prompts: {},
			timelines: [],
			locales: args.locales,
		}),
		runReplyHandlers,
		archive: {
			/**
			 * 空投影。
			 * @returns {object[]} 空数组
			 */
			projectArchiveEntries: () => [],
			/**
			 * 不写入档案。
			 * @returns {null} null
			 */
			writeParentArchive: () => null,
			/**
			 * 不删除档案。
			 * @returns {void}
			 */
			removeParentArchive: () => { },
			/**
			 * 不清理档案。
			 * @returns {number} 0
			 */
			cleanupExpiredArchives: () => 0,
		},
		/**
		 * 固定当前时间。
		 * @returns {number} 毫秒时间戳
		 */
		now: () => Date.now(),
	}
}

/**
 * 构造父代请求。
 * @param {object} [extension] 扩展
 * @returns {object} 父代请求
 */
function createParentArgs(extension = {}) {
	return {
		chat_name: 'test_chat',
		char_id: 'char-1',
		username: 'user-1',
		Charname: 'Char',
		UserCharname: 'User',
		CharUid: 'char-uid',
		UserUid: 'user-uid',
		supported_functions: { markdown: true },
		chat_log: [{ role: 'user', uid: 'user-uid', name: 'User', content: 'hello', time_stamp: 0 }],
		timelines: [],
		locales: ['en-UK'],
		world: undefined,
		user: undefined,
		char: undefined,
		other_chars: {},
		other_personas: {},
		plugins: {},
		chat_scoped_char_memory: {},
		workdir: { machine: '0', path: '/tmp' },
		extension,
	}
}

/**
 * 轮询等待条件成立。
 * @param {() => boolean} predicate 条件
 * @param {number} [timeoutMs] 超时
 * @returns {Promise<void>}
 */
async function waitFor(predicate, timeoutMs = 3000) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (predicate()) return
		await new Promise(resolve => setTimeout(resolve, 10))
	}
	throw new Error('waitFor timed out')
}

Deno.test('runSubAgent runs a synchronous loop and isolates the parent workdir', async () => {
	resetSubAgentState()
	const ai = createFakeAi(['round-1', 'round-2'])
	const plugin = createRegenPlugin(1, args => { args.workdir.path = '/mutated' })
	const parentArgs = createParentArgs()
	const outcome = await runSubAgent(
		parentArgs,
		{ body: 'do the task', plugins: ['file-operations'], roundLimit: 5, timeLimitMs: 60_000 },
		createDeps(ai, plugin),
	)
	assertEquals(outcome.text, 'round-2')
	assertEquals(outcome.run.state, 'done')
	assertEquals(outcome.run.rounds, 2)
	assertEquals(outcome.run.pluginNames, ['file-operations', 'sub-agent', 'async-task'])
	assertEquals(outcome.run.task, 'do the task')
	assertEquals(parentArgs.workdir, { machine: '0', path: '/tmp' })
})

Deno.test('runSubAgent consumes ancestor round budgets hierarchically', async () => {
	resetSubAgentState()
	const parent = { runId: 'parent-run', parentRunId: null, depth: 0, rounds: 0, roundLimit: 99, deadline: Date.now() + 60_000, state: 'running', username: 'user-1', charId: 'char-1' }
	createRun(parent)
	const ai = createFakeAi(['a', 'b'])
	const deps = createDeps(ai, createRegenPlugin(1))
	const outcome = await runSubAgent(
		createParentArgs({ subAgent: { runId: 'parent-run', depth: 0 } }),
		{ body: 'nested', roundLimit: 5, timeLimitMs: 60_000 },
		deps,
	)
	assertEquals(outcome.run.rounds, 2)
	assertEquals(parent.rounds, 2)
})

Deno.test('runSubAgent summarizes when the round budget is exceeded', async () => {
	resetSubAgentState()
	const ai = createFakeAi(['r1', 'r2', 'r3'], 'OVER-LIMIT-SUMMARY')
	const deps = createDeps(ai, createRegenPlugin(99))
	const outcome = await runSubAgent(
		createParentArgs(),
		{ body: 'loop', roundLimit: 2, timeLimitMs: 60_000 },
		deps,
	)
	assertEquals(outcome.text, 'OVER-LIMIT-SUMMARY')
	assertEquals(outcome.run.state, 'done')
	assertEquals(ai.summaryCalls, 1)
	assertEquals(outcome.run.rounds, 2)
})

Deno.test('runSubAgent async returns a backgroundId and releases the run after completion', async () => {
	resetSubAgentState()
	const ai = createFakeAi(['async-result'])
	const deps = createDeps(ai, createRegenPlugin(0))
	const outcome = await runSubAgent(
		createParentArgs(),
		{ body: 'background', roundLimit: 3, timeLimitMs: 60_000, async: true },
		deps,
	)
	assert(outcome.backgroundId, 'expected a backgroundId')
	// 生命周期：动作结束、历史落盘并通知父代后，内存中的 run 被释放，只能从生成历史回落。
	await waitFor(() => getRun(outcome.backgroundId) === undefined)
	await waitFor(() => deps.records.length === 1)
	assertEquals(deps.records[0].response, 'async-result')
	assertEquals(deps.notifications.at(-1).state, 'done')
})

Deno.test('completed async sub-agent is retrievable before the parent regen loop ends', async () => {
	resetSubAgentState()
	resetAsyncTaskState()
	const parentArgs = createParentArgs({ generationId: 'parent-regen' })
	const outcome = await runSubAgent(
		parentArgs,
		{ body: 'background', roundLimit: 3, timeLimitMs: 60_000, async: true },
		createDeps(createFakeAi(['subagent-final-answer']), createRegenPlugin(0)),
	)
	await waitFor(() => getRun(outcome.backgroundId) === undefined)
	const result = await awaitTasks([outcome.backgroundId], { requester: ownerFromArgs(parentArgs) })
	assertEquals(result.settled[0].result.finalText, 'subagent-final-answer')
	finishAsyncGeneration('parent-regen')
	assertEquals((await awaitTasks([outcome.backgroundId], { requester: ownerFromArgs(parentArgs) })).unknown, [outcome.backgroundId])
})

Deno.test('runSubAgent persists the internal conversation and emits live status', async () => {
	resetSubAgentState()
	const ai = createFakeAi(['hello there'])
	/**
	 * 用于验证流式消息推送的假 AI 回复。
	 * @param {object} _prompt 提示
	 * @param {object} options 生成选项
	 * @returns {Promise<object>} 假回复
	 */
	ai.StructCall = async (_prompt, options) => {
		options.replyPreviewUpdater?.({ content: 'partial' })
		options.onToolOutput?.({ phase: 'chunk', data: 'tool output' })
		options.base_result.content = 'hello there'
		return { content: 'hello there' }
	}
	const deps = createDeps(ai, createRegenPlugin(0, args => args.AddLongTimeLog({ role: 'tool', content: 'tool log' })))
	const outcome = await runSubAgent(
		createParentArgs(),
		{ body: 'collect', roundLimit: 3, timeLimitMs: 60_000 },
		deps,
	)
	await waitFor(() => deps.records.length === 1)
	const record = deps.records[0]
	assertEquals(record.conversationId, 'subagent:' + outcome.run.runId)
	assert(Array.isArray(record.conversation), 'expected conversation in the generation record')
	assert(record.conversation.some(entry => entry.role === 'system'), 'expected opening entries')
	assert(record.conversation.some(entry => entry.role === 'tool' && entry.content === 'tool log'), 'expected tool transcript')
	assertEquals(outcome.run.promptConversation.some(entry => entry.role === 'tool'), false)
	assert(deps.notifications.some(payload => payload.preview?.content === 'partial'), 'expected stream preview event')
	assert(deps.notifications.some(payload => payload.toolOutput?.data === 'tool output'), 'expected tool output event')
	const last = deps.notifications.at(-1)
	assertEquals(last.state, 'done')
	assertEquals(last.runId, outcome.run.runId)
	assertEquals(last.chat_name, 'test_chat')
	assert(deps.notifications.some(payload => payload.state === 'running'), 'expected a running notification')
})

Deno.test('async sub-agent exposes a live inspect preview while running', async () => {
	resetSubAgentState()
	resetAsyncTaskState()
	const { ai, release } = createBlockingAi()
	const deps = createDeps(ai, createRegenPlugin(0))
	const parentArgs = createParentArgs()
	const outcome = await runSubAgent(
		parentArgs,
		{ body: 'long task', roundLimit: 3, timeLimitMs: 60_000, async: true },
		deps,
	)
	assert(outcome.backgroundId, 'expected a backgroundId')
	// 运行中即可检视：返回最近的对话条目，且不消费任务（不抑制完成通知）。
	const inspected = inspectTask(outcome.backgroundId, ownerFromArgs(parentArgs))
	assertEquals(inspected.ok, true)
	assertEquals(inspected.preview.state, 'running')
	assert(Array.isArray(inspected.preview.entries))
	assert(inspected.preview.entries.length > 0, 'expected conversation entries')
	assert(inspected.preview.entries.every(entry =>
		typeof entry.role === 'string' && typeof entry.name === 'string' && typeof entry.content === 'string'
	))
	assertEquals(inspected.task.consumed, false, '检视不应消费任务')
	release()
	await waitFor(() => getRun(outcome.backgroundId) === undefined)
})

Deno.test('inspectTask matches ownership and rejects cross-session inspection', async () => {
	resetSubAgentState()
	resetAsyncTaskState()
	const { ai, release } = createBlockingAi()
	const deps = createDeps(ai, createRegenPlugin(0))
	const parentArgs = createParentArgs()
	const outcome = await runSubAgent(
		parentArgs,
		{ body: 'owned task', roundLimit: 3, timeLimitMs: 60_000, async: true },
		deps,
	)
	const foreign = { username: 'user-2', charId: 'char-1', chatName: 'other_chat' }
	assertEquals(inspectTask(outcome.backgroundId, foreign).reason, 'forbidden')
	assertEquals(inspectTask('missing-id', ownerFromArgs(parentArgs)).reason, 'not_found')
	release()
	await waitFor(() => getRun(outcome.backgroundId) === undefined)
})

Deno.test('runSubAgent rejects over-depth and missing-limit spawns', async () => {
	resetSubAgentState()
	const deps = createDeps(createFakeAi(['x']), createRegenPlugin(0))
	const parent = { runId: 'deep-parent', parentRunId: null, depth: 1, rounds: 0, roundLimit: 9, deadline: Date.now() + 60_000, state: 'running', username: 'user-1', charId: 'char-1' }
	createRun(parent)

	await assertRejects(
		() => runSubAgent(
			createParentArgs({ subAgent: { runId: 'deep-parent', depth: 1 } }),
			{ body: 'too deep', roundLimit: 2, timeLimitMs: 60_000 },
			deps,
		),
		SubAgentError,
		'maxDepth',
	)
	await assertRejects(
		() => runSubAgent(createParentArgs(), { body: 'no limits' }, deps),
		SubAgentError,
		'round-limit',
	)
})

Deno.test('runSubAgent settles the async task failed when the run fails', async () => {
	resetSubAgentState()
	resetAsyncTaskState()
	/** 捕获结算事件。 */
	const settles = []
	setAsyncTaskNotifier(event => { if (event.phase === 'settle') settles.push(event.task) })
	const ai = createFakeAi(['x'])
	/**
	 * 模拟 AI 源直接报错。
	 * @returns {Promise<void>} 始终 reject
	 */
	ai.StructCall = async () => { throw new Error('ai boom') }
	const deps = createDeps(ai, createRegenPlugin(0))
	const outcome = await runSubAgent(
		createParentArgs(),
		{ body: 'fail', roundLimit: 2, timeLimitMs: 60_000, async: true },
		deps,
	)
	await waitFor(() => settles.length === 1)
	assertEquals(settles[0].state, 'failed')
	await waitFor(() => getRun(outcome.backgroundId) === undefined)
	resetAsyncTaskState()
})

Deno.test('an AI-source error past the deadline fails instead of summarizing', async () => {
	resetSubAgentState()
	let clock = 0
	const ai = createFakeAi(['x'])
	/**
	 * 模拟 AI 源在超过 deadline 后报错。
	 * @returns {Promise<void>} 始终 reject
	 */
	ai.StructCall = async () => { clock = 1_000_000; throw new Error('source error') }
	const deps = createDeps(ai, createRegenPlugin(0))
	/**
	 * 受控当前时间。
	 * @returns {number} 毫秒时间戳
	 */
	deps.now = () => clock
	const outcome = await runSubAgent(
		createParentArgs(),
		{ body: 'boom', roundLimit: 2, timeLimitMs: 1000 },
		deps,
	)
	assertEquals(outcome.run.state, 'failed')
	assertEquals(ai.summaryCalls, 0)
})
