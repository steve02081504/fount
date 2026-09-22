/**
 * 【文件】src/public/parts/plugins/sub-agent/runtime.mjs
 * 【职责】sub-agent 插件运行时：解析插件集 / AI 源 / 限额，创建运行，跑插件自有的生成循环（不调用 char.GetReply），超限或终止时摘要，最后清理档案、记录生成历史并回投异步通知。
 * 【原理】子代理是一条独立生成链：`buildPromptStruct(args)`（仍含 char.GetPrompt，因此保持人格）→ `aiSource.StructCall` → `runReplyHandlers` 循环；
 *   `args.plugins` 严格等于 resolvePluginList 的结果，绝不与父代插件并集。每轮 `propagateRoundsToAncestors` 让当前运行与所有祖先共同消费轮次，任一祖先超限即转摘要。
 *   服务器依赖（parts_loader / agent_studio）通过动态 import 与可注入的 `deps` 提供，便于集成测试在不启动节点的情况下替换。
 * 【数据结构】run_t 见 state.mjs；deps = { loadPart, loadAnyPreferredDefaultPart, listAiSources, recordGeneration, buildPromptStruct, runReplyHandlers, archive, now, config }。
 * 【关联】handler.mjs 解析标签后调用 `runSubAgent` / `terminateSubAgentRun` / `listAvailableAiSources`；prompt.mjs 注入预算；archive.mjs 管理父代档案；state.mjs 保存注册表。
 */
import { buildPromptStruct } from '../../shells/chat/src/prompt_struct/index.mjs'
import { runReplyHandlers } from '../../shells/chat/src/reply/handlerPipeline.mjs'
import { registerTask } from '../async-task/registry.mjs'

import { cleanupExpiredArchives, projectArchiveEntries, removeParentArchive, writeParentArchive } from './archive.mjs'
import { makeRoundBudgetEntry } from './prompt.mjs'
import {
	countActiveRunsForAgent,
	countActiveRunsInBatch,
	createRun,
	getBatch,
	getRun,
	getRunByBackgroundId,
	getSubAgentConfig,
	isRunOverLimit,
	isRunTimeExceeded,
	propagateRoundsToAncestors,
	resolvePluginList,
} from './state.mjs'

/** 时长解析统一由 async-task 提供（`<await-async time-limit>` 与 `run-subagent` 共用）。 */
export { parseDurationMs } from '../async-task/duration.mjs'

/** 单条工具回执 / 通知中保留的结果长度上限。 */
const RESULT_ECHO_LIMIT = 4000

/**
 * 子代理运行错误（带机器可读 code，供 handler 写严格错误工具日志）。
 */
export class SubAgentError extends Error {
	/**
	 * @param {string} code 错误码
	 * @param {string} message 可读信息
	 */
	constructor(code, message) {
		super(message)
		this.name = 'SubAgentError'
		this.code = code
	}
}

/**
 * 把轮次声明解析为正整数。
 * @param {string | number | null | undefined} value 轮次声明
 * @returns {number | null} 轮次数；无法解析返回 null
 */
export function parseRoundLimit(value) {
	if (value == null || value === '') return null
	const amount = Math.floor(Number(value))
	return Number.isFinite(amount) && amount > 0 ? amount : null
}

/**
 * 解析布尔属性（存在且非 `false`/`0` 即真）。
 * @param {string | boolean | null | undefined} value 属性值
 * @returns {boolean} 布尔值
 */
export function parseBooleanAttr(value) {
	if (typeof value === 'boolean') return value
	return value != null && value !== '' && value !== 'false' && value !== '0'
}

/**
 * 默认 `loadPart` 实现（延迟载入服务器模块）。
 * @param {string} username 用户
 * @param {string} partpath 部件路径
 * @returns {Promise<any>} 部件
 */
async function defaultLoadPart(username, partpath) {
	const { loadPart } = await import('../../../../server/parts_loader.mjs')
	return loadPart(username, partpath)
}

/**
 * 默认首选默认部件实现。
 * @param {string} username 用户
 * @param {string} parent 父部件路径
 * @returns {Promise<any>} 部件
 */
async function defaultLoadAnyPreferredDefaultPart(username, parent) {
	const { loadAnyPreferredDefaultPart } = await import('../../../../server/parts_loader.mjs')
	return loadAnyPreferredDefaultPart(username, parent)
}

/**
 * 默认 AI 源枚举实现。
 * @param {string} username 用户
 * @returns {Promise<Array<{ name: string, title: string, description: string, context_size?: number | null, is_paid?: boolean | null, filename?: string | null }>>} AI 源列表
 */
async function defaultListAiSources(username) {
	const { getAllCachedPartDetails } = await import('../../../../server/parts_loader.mjs')
	const { cachedDetails, uncachedNames } = await getAllCachedPartDetails(username, 'serviceSources/AI')
	const cached = await Promise.all(Object.entries(cachedDetails).map(async ([name, details]) => {
		const base = {
			name,
			title: details?.info?.name ?? name,
			description: details?.info?.description ?? '',
		}
		try {
			const part = await defaultLoadPart(username, 'serviceSources/AI/' + name)
			return { ...base, context_size: part?.context_size ?? null, is_paid: part?.is_paid ?? null, filename: part?.filename ?? null }
		}
		catch {
			return base
		}
	}))
	const uncached = uncachedNames.map(name => ({ name, title: name, description: '' }))
	return [...cached, ...uncached]
}

/**
 * 默认生成历史记录实现（尽力而为，失败不影响主流程）。
 * @param {string} username 用户
 * @param {object} record 记录
 * @returns {Promise<void>}
 */
async function defaultRecordGeneration(username, record) {
	try {
		const { recordGeneration } = await import('../../shells/agent_studio/src/generation_history.mjs')
		await recordGeneration(username, record)
	}
	catch (error) {
		console.warn('sub-agent: recordGeneration 失败', error)
	}
}

/**
 * 默认运行状态通知实现：经用户事件通道推送给前端（尽力而为）。
 * @param {string} username 用户
 * @param {object} payload 运行状态摘要
 * @returns {Promise<void>}
 */
async function defaultNotifyRun(username, payload) {
	try {
		const { sendEventToUser } = await import('../../../../server/web_server/event_dispatcher.mjs')
		sendEventToUser(username, 'subagent-run', payload)
	}
	catch (error) {
		console.warn('sub-agent: notifyRun 失败', error)
	}
}

/**
 * 取任务首行预览（用于异步任务的标签）。
 * @param {string} task 任务文本
 * @returns {string} 预览
 */
function taskPreview(task) {
	const line = String(task ?? '').split(/\r?\n/).find(text => text.trim())?.trim() ?? ''
	return line.length > 80 ? `${line.slice(0, 80)}…` : line
}

/** 默认依赖集合；集成测试可传入同形状的替身。 */
export const defaultSubAgentDeps = {
	loadPart: defaultLoadPart,
	loadAnyPreferredDefaultPart: defaultLoadAnyPreferredDefaultPart,
	listAiSources: defaultListAiSources,
	recordGeneration: defaultRecordGeneration,
	notifyRun: defaultNotifyRun,
	buildPromptStruct,
	runReplyHandlers,
	archive: { cleanupExpiredArchives, projectArchiveEntries, removeParentArchive, writeParentArchive },
	/**
	 * 可注入的当前时间源。
	 * @returns {number} 毫秒时间戳
	 */
	now: () => Date.now(),
}

/**
 * 运行状态摘要（推送给宿主 shell 的实时事件负载）。
 * @param {object} run 运行
 * @returns {object} 状态摘要
 */
function runStatusPayload(run) {
	return {
		runId: run.runId,
		backgroundId: run.backgroundId,
		parentRunId: run.parentRunId,
		batchId: run.batchId,
		chat_name: run.chat_name,
		charId: run.charId,
		state: run.state,
		rounds: run.rounds,
		roundLimit: run.roundLimit,
		depth: run.depth,
		isAsync: run.isAsync,
		task: run.task,
		startedAt: run.startedAt,
		finishedAt: run.finishedAt,
		error: run.error?.message ?? null,
	}
}

/**
 * 推送一次运行状态（可注入的 deps.notifyRun 缺省时静默跳过）。
 * @param {object} run 运行
 * @param {object} deps 依赖
 * @returns {void}
 */
function emitRunStatus(run, deps) {
	try {
		void deps.notifyRun?.(run.username, runStatusPayload(run))
	}
	catch (error) {
		console.warn('sub-agent: 推送运行状态失败', error)
	}
}

/**
 * 序列化子代理内部对话供落盘（剥离文件 buffer，逐条限长）。
 * @param {object[]} conversation 对话
 * @returns {object[]} 可 JSON 化的条目
 */
function serializeConversation(conversation) {
	return (conversation ?? []).map(entry => ({
		role: entry.role,
		name: entry.name,
		uid: entry.uid,
		time_stamp: entry.time_stamp,
		content: truncate(entry.content ?? '', 20000),
		content_for_show: truncate(entry.content_for_show ?? entry.content ?? '', 20000),
	}))
}

/**
 * 截断长文本用于回执。
 * @param {string} text 文本
 * @param {number} [limit] 上限
 * @returns {string} 截断文本
 */
function truncate(text, limit = RESULT_ECHO_LIMIT) {
	const value = String(text ?? '')
	return value.length > limit ? `${value.slice(0, limit)}\n…（已截断 ${value.length - limit} 字符）` : value
}

/**
 * 解析子代理使用的 AI 源。
 * @param {string} username 用户
 * @param {object} parentArgs 父代请求
 * @param {string | null} explicitName 显式 AI 源名
 * @param {object} deps 依赖
 * @returns {Promise<any>} AI 源
 */
async function resolveAiSource(username, parentArgs, explicitName, deps) {
	if (explicitName)
		return deps.loadPart(username, 'serviceSources/AI/' + explicitName)
	if (parentArgs?.ai_source)
		return parentArgs.ai_source
	return deps.loadAnyPreferredDefaultPart(username, 'serviceSources/AI')
}

/**
 * 按解析后的插件名列表加载插件；单个插件缺失只警告、不阻断。
 * @param {string} username 用户
 * @param {string[]} names 插件名
 * @param {object} deps 依赖
 * @returns {Promise<Record<string, any>>} 插件表
 */
async function loadPluginMap(username, names, deps) {
	const entries = await Promise.all(names.map(async name => {
		try {
			return [name, await deps.loadPart(username, 'plugins/' + name)]
		}
		catch (error) {
			console.warn(`sub-agent: 无法加载插件 "${name}"`, error)
			return null
		}
	}))
	return Object.fromEntries(entries.filter(Boolean))
}

/**
 * 写入子代理自己的对话（绝不写父代）。
 * @param {object} run 运行
 * @param {object} entry 条目
 * @returns {object} 规范化后的条目
 */
function appendChildConversationEntry(run, entry) {
	const logEntry = {
		id: entry.id ?? crypto.randomUUID(),
		name: entry.name ?? run.parentArgs?.Charname ?? '',
		uid: entry.uid ?? run.parentArgs?.CharUid ?? 'char',
		role: entry.role ?? 'char',
		time_stamp: entry.time_stamp ?? new Date(),
		content: entry.content ?? '',
		content_for_show: entry.content_for_show ?? entry.content ?? '',
		files: entry.files ?? [],
		charVisibility: entry.charVisibility ?? [run.charId],
		extension: entry.extension ?? {},
	}
	run.conversation.push(logEntry)
	return logEntry
}

/**
 * 构造子代理请求上下文：继承父代世界/用户/角色/locales/他者，重写对话、插件、工作目录与扩展。
 * @param {object} run 运行
 * @returns {object} 子代理 chatReplyRequest
 */
function buildChildArgs(run) {
	const parentArgs = run.parentArgs
	const childArgs = {
		...parentArgs,
		chat_log: run.conversation,
		timelines: [],
		chat_summary: '',
		chat_scoped_char_memory: {},
		workdir: parentArgs.workdir ? { ...parentArgs.workdir } : {},
		plugins: run.plugins,
		ai_source: run.aiSource,
		generation_options: {},
		extension: { ...parentArgs.extension, subAgent: run.subAgent },
		/**
		 * 把条目写入子代理自己的对话。
		 * @param {object} entry 回复条目
		 * @returns {Promise<object>} 规范化后的日志条目
		 */
		AddChatLogEntry: async entry => appendChildConversationEntry(run, entry),
	}
	/**
	 * 返回当前子请求上下文。
	 * @returns {Promise<object>} 子代理请求
	 */
	childArgs.Update = async () => childArgs
	return childArgs
}

/**
 * 构造开场 system 条目：批次共享上下文 + 任务与档案指引。
 * @param {object} run 运行
 * @param {object | undefined} batch 批次
 * @returns {object[]} 开场条目
 */
function buildOpeningEntries(run, batch) {
	const opening = []
	if (batch?.commonContext?.trim())
		opening.push({
			name: 'system',
			uid: 'system',
			role: 'system',
			content: `共享背景上下文：\n${batch.commonContext}`,
			files: [],
		})
	const archiveGuide = run.archivePath
		? `父代聊天档案（JSON，含 role/name/uid/time_stamp/content）位于：\n${run.archivePath}\n需要父代细节时请自行用文件工具检索它。若你没有文件工具，请直接失败并向父代报告。`
		: '父代聊天档案不可用（写入失败）。若你需要父代细节且没有其它途径，请直接失败并向父代报告。'
	const contextGuide = run.pluginNames?.includes('code-execution')
		? '\n\n环境提示：工作目录/文件系统与父代共享（不是隔离副本）；但 code-execution 提供的 workspace 是**独立的新对象**（不继承父代变量），chat_log 是**你自己的对话**。'
		: ''
	opening.push({
		name: 'system',
		uid: 'system',
		role: 'system',
		content: `任务：\n${run.task}\n\n${archiveGuide}${contextGuide}`,
		files: [],
	})
	return opening
}

/**
 * 构造摘要提示词。
 * @param {object} run 运行
 * @param {'terminated' | 'limit'} reason 摘要原因
 * @returns {string} 摘要提示
 */
function buildSummaryPrompt(run, reason) {
	const reasonText = reason === 'terminated'
		? '父代已请求终止你，请立即收尾。'
		: '你已到达轮次或时间预算上限，必须立即收尾。'
	const transcript = describeRunConversation(run, 8)
	return `\
你是一个子代理，现在必须结束工作并给出最终交付。

${reasonText}

原始任务：
${run.task}

最近的对话与工具结果：
${transcript}

请输出一份简洁、可执行的最终结果（完成了什么、关键发现、产出物路径、未完成项与建议）。不要再请求任何工具。`
}

/**
 * 生成 sub-agent 异步任务的完成通知文本（供 async-task 注册表在结算时调用）。
 * @param {object} task async-task 任务（`result` 为 run）
 * @returns {string} 通知文本
 */
function subAgentNotificationText(task) {
	const run = task.result ?? {}
	const batchActive = run.batchId ? countActiveRunsInBatch(run.batchId) : 0
	const agentActive = run.username ? countActiveRunsForAgent(run.username, run.charId) : 0
	return `\
[sub-agent] 后台子代理 ${run.backgroundId ?? task.id} 已完成（状态：${run.state ?? task.state}）。
同批次进行中：${batchActive} 个；该角色剩余活跃子代理：${agentActive} 个。

结果：
${truncate(run.finalText ?? run.error?.message ?? '')}`
}

/**
 * 生成运行摘要并把结果写回 `run.finalText`。
 * @param {object} run 运行
 * @param {object} deps 依赖
 * @param {'terminated' | 'limit'} reason 原因
 * @returns {Promise<void>}
 */
async function summarizeRun(run, deps, reason) {
	run.state = 'summarizing'
	run.summaryReason = reason
	let text = null
	try {
		text = await run.aiSource?.Call?.(buildSummaryPrompt(run, reason))
	}
	catch (error) {
		console.warn('sub-agent: 摘要调用失败', error)
	}
	if (text && typeof text === 'object') text = text.content ?? text.text ?? ''
	if (typeof text !== 'string' || !text.trim())
		text = `子代理已${reason === 'terminated' ? '被终止' : '达到上限'}，未能生成摘要。最后产出：\n${truncate(run.result?.content ?? '', 1000)}`
	run.finalText = text
	run.state = reason === 'terminated' ? 'terminated' : 'done'
}

/**
 * 记录一次子代理运行到 Agent Studio 生成历史。
 * @param {object} run 运行
 * @param {object} deps 依赖
 * @returns {Promise<void>}
 */
async function recordRunGeneration(run, deps) {
	try {
		await deps.recordGeneration(run.username, {
			charId: run.charId,
			charname: run.parentArgs?.Charname,
			chatId: run.chat_name,
			conversationId: 'subagent:' + run.runId,
			source: 'plugins/sub-agent',
			parentId: run.parentGenerationId,
			subAgent: {
				runId: run.runId,
				parentRunId: run.parentRunId,
				batchId: run.batchId,
				backgroundId: run.backgroundId,
			},
			startedAt: run.startedAt,
			finishedAt: run.finishedAt,
			model: run.aiSource?.filename,
			input: run.parentArgs?.chat_log?.slice(-run.archiveTail),
			conversation: serializeConversation(run.conversation),
			response: run.finalText,
			metadata: {
				status: run.state,
				rounds: run.rounds,
				task: run.task,
				durationMs: (run.finishedAt ?? deps.now()) - (run.startedAt ?? run.createdAt),
				terminated: run.terminateRequested,
			},
		})
	}
	catch (error) {
		console.warn('sub-agent: 记录生成失败', error)
	}
}

/**
 * 执行子代理运行（不抛出；失败写入 run 状态与 finalText）。
 * @param {object} run 运行
 * @param {object} [deps] 依赖
 * @returns {Promise<object>} 运行
 */
export async function executeSubAgentRun(run, deps = defaultSubAgentDeps) {
	run.startedAt = deps.now()
	run.state = 'running'
	emitRunStatus(run, deps)
	try {
		const entries = deps.archive.projectArchiveEntries(run.parentArgs?.chat_log, run.archiveTail)
		run.archivePath = deps.archive.writeParentArchive(run.runId, entries)
		deps.archive.cleanupExpiredArchives?.()
	}
	catch (error) {
		run.archivePath = null
		console.warn('sub-agent: 父代档案写入失败', error)
	}

	const batch = run.batchId ? getBatch(run.batchId) : undefined
	run.conversation.push(...buildOpeningEntries(run, batch))
	const childArgs = buildChildArgs(run)

	let summarized = false
	try {
		const promptStruct = await deps.buildPromptStruct(childArgs)
		const result = run.result = { content: '', logContextBefore: [], logContextAfter: [], files: [], extension: {} }
		const handlers = Object.values(run.plugins)
			.map(plugin => plugin?.interfaces?.chat?.ReplyHandler)
			.filter(Boolean)
		/**
		 * 子代理本地的长时间日志写入：追加到结果上下文与 char additional_chat_log。
		 * @param {object} entry 日志条目
		 * @returns {void}
		 */
		const AddLongTimeLog = entry => {
			entry.uid ??= entry.role === 'char' ? childArgs.CharUid
				: entry.role === 'user' ? childArgs.UserUid
					: 'system'
			entry.charVisibility ??= [run.charId]
			result.logContextBefore.push(entry)
			promptStruct.char_prompt.additional_chat_log.push(entry)
		}
		const generationOptions = {
			signal: run.controller.signal,
			supported_functions: childArgs.supported_functions,
		}
		childArgs.generation_options = generationOptions
		run.timer = setTimeout(() => {
			run.summaryReason ??= 'time'
			run.controller.abort()
		}, run.timeLimitMs)

		regen: while (true) {
			if (run.terminateRequested) {
				await summarizeRun(run, deps, 'terminated')
				summarized = true
				break
			}
			generationOptions.base_result = result
			await run.aiSource.StructCall(promptStruct, generationOptions)
			propagateRoundsToAncestors(run, getRun)
			emitRunStatus(run, deps)
			if (run.terminateRequested) {
				await summarizeRun(run, deps, 'terminated')
				summarized = true
				break
			}
			if (isRunOverLimit(run, getRun, deps.now())) {
				run.summaryReason ??= 'limit'
				await summarizeRun(run, deps, 'limit')
				summarized = true
				break
			}
			const wantRegen = await deps.runReplyHandlers(
				result,
				{ ...childArgs, prompt_struct: promptStruct, AddLongTimeLog },
				handlers,
			)
			if (!wantRegen) break
			promptStruct.char_prompt.additional_chat_log.push(makeRoundBudgetEntry(run, deps.now()))
			continue regen
		}
		if (!summarized) {
			run.finalText = result.content ?? ''
			run.state = 'done'
		}
	}
	catch (error) {
		if (run.terminateRequested) {
			await summarizeRun(run, deps, 'terminated')
			summarized = true
		}
		else if (run.summaryReason === 'time' || isRunTimeExceeded(run, deps.now())) {
			await summarizeRun(run, deps, 'limit')
			summarized = true
		}
		else {
			run.state = 'failed'
			run.error = { name: error?.name, message: error?.message ?? String(error) }
			run.finalText = `子代理运行失败：${run.error.message}`
		}
	}
	finally {
		if (run.timer) clearTimeout(run.timer)
		run.finishedAt = deps.now()
		deps.archive.removeParentArchive(run.archivePath)
		emitRunStatus(run, deps)
		void recordRunGeneration(run, deps)
	}
	return run
}

/**
 * 创建并（同步或异步）运行一个子代理。
 * @param {object} args 父代 chatReplyRequest
 * @param {object} request 已解析的请求字段
 * @param {string} [request.body] 任务文本
 * @param {string[]} [request.plugins] 显式插件列表
 * @param {string | null} [request.aiSource] 显式 AI 源名
 * @param {number | null} [request.roundLimit] 轮次上限
 * @param {number | null} [request.timeLimitMs] 时间上限（毫秒）
 * @param {boolean} [request.async] 是否异步
 * @param {string | null} [request.batchId] 批次 id
 * @param {object} [deps] 依赖
 * @returns {Promise<{ text?: string, backgroundId: string | null, run: object }>} 同步返回 text，异步返回 backgroundId
 */
export async function runSubAgent(args, request, deps = defaultSubAgentDeps) {
	const username = args.username
	const charId = args.char_id
	const config = getSubAgentConfig()
	const parentRunId = args.extension?.subAgent?.runId ?? null
	const parent = parentRunId ? getRun(parentRunId) : null
	const depth = parent ? (parent.depth ?? 0) + 1 : 0
	if (depth >= (config.maxDepth ?? 2))
		throw new SubAgentError('depth_exceeded', `子代理深度已达上限（maxDepth=${config.maxDepth ?? 2}，当前深度 ${depth}）。`)

	const batch = request.batchId ? getBatch(request.batchId) : null
	if (request.batchId && !batch)
		throw new SubAgentError('batch_not_found', `未找到批次 "${request.batchId}"。`)

	const roundLimit = request.roundLimit ?? batch?.defaultRoundLimit ?? null
	const timeLimitMs = request.timeLimitMs ?? batch?.defaultTimeLimitMs ?? null
	if (roundLimit == null || timeLimitMs == null)
		throw new SubAgentError('limits_required', 'run-subagent 必须提供 round-limit 与 time-limit（或使用带有默认值的批次）。')

	const explicitPlugins = request.plugins?.length ? request.plugins : batch?.defaultPlugins
	const pluginNames = resolvePluginList(explicitPlugins)
	const plugins = await loadPluginMap(username, pluginNames, deps)

	const aiSource = await resolveAiSource(username, args, request.aiSource ?? batch?.defaultAiSource, deps)
	if (!aiSource)
		throw new SubAgentError('no_ai_source', '未找到可用的 AI 源，且父代未提供。')

	const runId = crypto.randomUUID()
	const now = deps.now()
	/** @type {import('./state.mjs').subAgentRun_t} */
	const run = {
		runId,
		backgroundId: runId,
		parentRunId,
		batchId: request.batchId ?? null,
		depth,
		username,
		charId,
		chat_name: args.chat_name ?? '',
		task: request.body ?? '',
		parentGenerationId: args.extension?.generationId ?? args.extension?.chat?.eventId ?? null,
		roundLimit,
		timeLimitMs,
		deadline: now + timeLimitMs,
		rounds: 0,
		state: 'running',
		terminateRequested: false,
		controller: new AbortController(),
		aiSource,
		plugins,
		pluginNames,
		archivePath: null,
		archiveTail: config.archiveTail ?? 50,
		conversation: [],
		result: null,
		finalText: null,
		summaryReason: null,
		error: null,
		isAsync: request.async,
		createdAt: now,
		startedAt: now,
		finishedAt: null,
		timer: null,
		parentArgs: args,
		subAgent: {
			runId,
			parentRunId,
			parentCharId: charId,
			batchId: request.batchId ?? null,
			depth,
			parentGenerationId: args.extension?.generationId ?? args.extension?.chat?.eventId ?? null,
		},
	}
	createRun(run)

	if (request.async) {
		registerTask({
			id: run.backgroundId,
			kind: 'subagent',
			label: taskPreview(run.task),
			owner: { username, charId, chatName: run.chat_name, parentRunId },
			/**
			 * 后台执行子代理运行。
			 * @returns {Promise<object>} 运行对象
			 */
			run: () => executeSubAgentRun(run, deps),
			meta: { runId: run.runId, batchId: run.batchId, depth },
			format: subAgentNotificationText,
		})
		return { backgroundId: run.backgroundId, run }
	}
	await executeSubAgentRun(run, deps)
	return { text: run.finalText ?? '', run }
}

/**
 * 请求终止一个运行（设置标志并 abort 其控制器，随后进入摘要）。
 * @param {string} id 运行 id 或 backgroundId
 * @returns {{ ok: boolean, run?: object, error?: string }} 结果
 */
export function terminateSubAgentRun(id) {
	const run = getRun(id) ?? getRunByBackgroundId(id)
	if (!run) return { ok: false, error: 'not_found' }
	run.terminateRequested = true
	try {
		run.controller.abort()
	}
	catch { /* 已中止则忽略 */ }
	return { ok: true, run }
}

/**
 * 取运行最近对话的结构化条目（用于 check-subagent 的可读 UI 与文本回执）。
 * @param {object} run 运行
 * @param {number} [limit] 最近条数
 * @param {number} [contentLimit] 每条内容上限
 * @returns {Array<{ role: string, name: string, content: string }>} 条目
 */
export function describeRunEntries(run, limit = 3, contentLimit = 1000) {
	const entries = [...run.conversation ?? [], ...run.result?.logContextBefore ?? []]
	return entries.slice(-limit).map(entry => ({
		role: entry.role ?? 'system',
		name: entry.name ?? '',
		content: truncate(entry.content_for_show ?? entry.content ?? '', contentLimit),
	}))
}

/**
 * 描述运行最近的对话（用于 check-subagent）。
 * @param {object} run 运行
 * @param {number} [limit] 最近条数
 * @returns {string} 文本
 */
export function describeRunConversation(run, limit = 3) {
	return describeRunEntries(run, limit, 1000)
		.map(entry => `[${entry.role}] ${entry.name}: ${entry.content}`)
		.join('\n---\n')
}

/**
 * 列出可用 AI 源。
 * @param {string} username 用户
 * @param {object} [deps] 依赖
 * @returns {Promise<Array<{ name: string, title: string, description: string }>>} AI 源列表
 */
export async function listAvailableAiSources(username, deps = defaultSubAgentDeps) {
	return deps.listAiSources(username)
}
