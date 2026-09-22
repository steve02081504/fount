/**
 * 【文件】src/public/parts/plugins/sub-agent/handler.mjs
 * 【职责】sub-agent 插件的 ReplyHandler 组：解析 `<create-subagent-batch>` / `<run-subagent>` / `<list-ai-sources>` / `<check-subagent>` / `<terminate-subagent>` 五个工具标签。
 * 【原理】标签层只做参数解析与工具回执；真正的解析、限额校验、生成循环在 runtime.mjs。严格错误（缺限额、深度超限、找不到批次/AI 源）以错误工具日志回报并建议下一轮生成。
 * 【数据结构】handler = defineReplyHandler(...)；批次 id 形如 `batch-<uuid>`。
 * 【关联】runtime.mjs 的 runSubAgent / terminateSubAgentRun / listAvailableAiSources / describeRunConversation / describeRunEntries / SubAgentError；state.mjs 的 createBatch / parsePluginListAttr；main.mjs 汇总为 ReplyHandler。
 */
import { defineReplyHandler, defineReplyHandlers } from '../../shells/chat/src/reply/defineReplyHandler.mjs'

import {
	describeRunConversation,
	describeRunEntries,
	listAvailableAiSources,
	parseBooleanAttr,
	parseDurationMs,
	parseRoundLimit,
	runSubAgent,
	SubAgentError,
	terminateSubAgentRun,
} from './runtime.mjs'
import { createBatch, getRun, getRunByBackgroundId, parsePluginListAttr } from './state.mjs'

/** 单个工具回执的长度上限。 */
const TOOL_ECHO_LIMIT = 4000

/**
 * 截断工具回执文本。
 * @param {string} text 文本
 * @param {number} [limit] 上限
 * @returns {string} 截断文本
 */
function echo(text, limit = TOOL_ECHO_LIMIT) {
	const value = String(text ?? '')
	return value.length > limit ? `${value.slice(0, limit)}\n…（已截断 ${value.length - limit} 字符）` : value
}

/**
 * 写一条 sub-agent 工具回执。
 * @param {object} args 请求上下文
 * @param {string} name 工具名（点分命名，供宿主 shell 映射人类可读标题）
 * @param {string} content 回执文本
 * @param {boolean} [isError] 是否为错误
 * @param {object} [extra] 额外字段（如 `extension.subAgent`，供宿主 shell 定位运行）
 * @returns {void}
 */
function writeToolLog(args, name, content, isError = false, extra = {}) {
	args.AddLongTimeLog?.({
		name,
		role: 'tool',
		content,
		content_for_show: content,
		files: [],
		...isError ? { extension: { error: true } } : {},
		...extra,
	})
}

/**
 * 由运行对象构造工具日志的 `extension.subAgent`（宿主 shell 据此渲染运行按钮并深链）。
 * @param {object} run 运行
 * @param {boolean} isAsync 是否异步派生
 * @returns {{ extension: { subAgent: object } }} 附加字段
 */
function runToolMeta(run, isAsync) {
	return {
		extension: {
			subAgent: {
				runId: run.runId,
				backgroundId: run.backgroundId,
				parentRunId: run.parentRunId,
				batchId: run.batchId,
				depth: run.depth,
				isAsync,
				task: run.task,
			},
		},
	}
}

/**
 * `<create-subagent-batch>`：创建带共享上下文与默认值的批次。
 * @type {import('../../../../decl/pluginAPI.ts').ReplyHandler_t}
 */
export const createSubAgentBatchHandler = defineReplyHandler({
	tag: 'create-subagent-batch',
	params: {
		plugins: 'string',
		'ai-source': 'string',
		'time-limit': 'string',
		'round-limit': 'string',
	},
	/**
	 * 创建批次。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @param {object} call 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const timeLimitMs = parseDurationMs(call.params['time-limit'])
		const roundLimit = parseRoundLimit(call.params['round-limit'])
		const batch = createBatch({
			batchId: `batch-${crypto.randomUUID()}`,
			username: args.username,
			charId: args.char_id,
			commonContext: call.body ?? '',
			defaultPlugins: call.params.plugins ? parsePluginListAttr(call.params.plugins) : null,
			defaultRoundLimit: roundLimit,
			defaultTimeLimitMs: timeLimitMs,
			defaultAiSource: call.params['ai-source'] || null,
		})
		writeToolLog(args, 'sub-agent.create-batch', `已创建子代理批次：${batch.batchId}（共享上下文 ${batch.commonContext.length} 字符）。后续用 batch="${batch.batchId}" 派生子代理。`)
		return { regen: true }
	},
})

/**
 * `<run-subagent>`：派生子代理（同步返回结果，异步返回 backgroundId）。
 * @type {import('../../../../decl/pluginAPI.ts').ReplyHandler_t}
 */
export const runSubAgentHandler = defineReplyHandler({
	tag: 'run-subagent',
	params: {
		plugins: 'string',
		'ai-source': 'string',
		'time-limit': 'string',
		'round-limit': 'string',
		async: 'boolean',
		batch: 'string',
	},
	/**
	 * 派生子代理。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @param {object} call 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const request = {
			body: call.body ?? '',
			plugins: call.params.plugins ? parsePluginListAttr(call.params.plugins) : [],
			aiSource: call.params['ai-source'] || null,
			roundLimit: parseRoundLimit(call.params['round-limit']),
			timeLimitMs: parseDurationMs(call.params['time-limit']),
			async: parseBooleanAttr(call.params.async),
			batchId: call.params.batch || null,
		}
		try {
			const outcome = await runSubAgent(args, request)
			if (request.async)
				writeToolLog(args, 'sub-agent.run', `子代理已在后台运行，backgroundId=${outcome.backgroundId}。可用 <await-async ids="${outcome.backgroundId}"/> 等待，或用 <list-async/> 查看；未被等待时完成后会以系统消息通知你。`, false, runToolMeta(outcome.run, true))
			else
				writeToolLog(args, 'sub-agent.run', `子代理已完成，最终结果：\n\n${echo(outcome.text)}`, false, runToolMeta(outcome.run, false))
		}
		catch (error) {
			if (error instanceof SubAgentError)
				writeToolLog(args, 'sub-agent.run', `子代理未启动（${error.code}）：${error.message}`, true)
			else {
				console.error('sub-agent: run-subagent 失败', error)
				writeToolLog(args, 'sub-agent.run', `子代理运行失败：${error?.message ?? error}`, true)
			}
		}
		return { regen: true }
	},
})

/**
 * `<list-ai-sources/>`：列出可用的 AI 源。
 * @type {import('../../../../decl/pluginAPI.ts').ReplyHandler_t}
 */
export const listAiSourcesHandler = defineReplyHandler({
	tag: 'list-ai-sources',
	/**
	 * 列出 AI 源。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args) => {
		try {
			const sources = await listAvailableAiSources(args.username)
			const lines = sources.length
				? sources.map(source => {
					const head = `- ${source.name}${source.title && source.title !== source.name ? `（${source.title}）` : ''}`
					const meta = []
					if (source.context_size) meta.push(`上下文 ${source.context_size}`)
					if (source.is_paid) meta.push('付费')
					const suffix = meta.length ? ` [${meta.join('，')}]` : ''
					const desc = source.description ? `\n  ${source.description}` : ''
					return head + suffix + desc
				}).join('\n')
				: '（无可用 AI 源）'
			writeToolLog(args, 'sub-agent.list-ai-sources', `可用 AI 源：\n${lines}`)
		}
		catch (error) {
			console.error('sub-agent: list-ai-sources 失败', error)
			writeToolLog(args, 'sub-agent.list-ai-sources', `枚举 AI 源失败：${error?.message ?? error}`, true)
		}
		return { regen: true }
	},
})

/**
 * `<check-subagent id="..."/>`：查看某运行最近的对话。
 * @type {import('../../../../decl/pluginAPI.ts').ReplyHandler_t}
 */
export const checkSubAgentHandler = defineReplyHandler({
	tag: 'check-subagent',
	params: { id: 'string' },
	/**
	 * 查看运行对话。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @param {object} call 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const id = call.params.id
		const run = getRun(id) ?? getRunByBackgroundId(id)
		if (!run) {
			writeToolLog(args, 'sub-agent.check', `未找到子代理运行 "${id}"。`, true)
			return { regen: true }
		}
		const conversationText = describeRunConversation(run, 3) || '（暂无对话）'
		writeToolLog(
			args,
			'sub-agent.check',
			`子代理 ${run.runId} 状态：${run.state}（轮次 ${run.rounds}/${run.roundLimit}）。最近对话：\n\n${echo(conversationText)}`,
			false,
			{
				extension: {
					subAgentCheck: {
						runId: run.runId,
						state: run.state,
						rounds: run.rounds,
						roundLimit: run.roundLimit,
						entries: describeRunEntries(run, 3, 4000),
					},
				},
			},
		)
		return { regen: true }
	},
})

/**
 * `<terminate-subagent id="..."/>`：请求终止某运行（随后进入摘要）。
 * @type {import('../../../../decl/pluginAPI.ts').ReplyHandler_t}
 */
export const terminateSubAgentHandler = defineReplyHandler({
	tag: 'terminate-subagent',
	params: { id: 'string' },
	/**
	 * 终止运行。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @param {object} call 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const outcome = terminateSubAgentRun(call.params.id)
		if (!outcome.ok)
			writeToolLog(args, 'sub-agent.terminate', `未找到子代理运行 "${call.params.id}"。`, true)
		else
			writeToolLog(args, 'sub-agent.terminate', `已请求终止子代理 ${outcome.run.runId}（软取消：在当前工具调用结束后、下一轮开始前生效并进入摘要；若它正卡在不可中断的进程内任务中，可能仍需等其自然结束，超时后也会强制收尾）。`)
		return { regen: true }
	},
})

/** sub-agent 插件的完整 ReplyHandler 组。 */
export const subAgentReplyHandlers = defineReplyHandlers([
	createSubAgentBatchHandler,
	runSubAgentHandler,
	listAiSourcesHandler,
	checkSubAgentHandler,
	terminateSubAgentHandler,
])
