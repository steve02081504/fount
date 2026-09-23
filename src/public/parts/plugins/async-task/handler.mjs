/**
 * 【文件】src/public/parts/plugins/async-task/handler.mjs
 * 【职责】async-task 插件的 ReplyHandler 组：解析 `<list-async>` / `<await-async>` 两个统一异步工具标签。
 * 【原理】标签层只做参数解析与工具回执；真正的任务注册表、等待与通知在 registry.mjs。
 *   提示词与工具回执固定中文（不做多语言化）。
 * 【数据结构】handler = defineReplyHandler(...)；`<await-async ids="a,b" mode="all|any" time-limit="5m"/>`。
 * 【关联】registry.mjs 的 listTasksForOwner / awaitTasks；prompt.mjs 注入说明；main.mjs 汇总为 ReplyHandler。
 */
import { msstr } from '../../../../scripts/ms.mjs'
import { defineReplyHandler, defineReplyHandlers } from '../../shells/chat/src/reply/defineReplyHandler.mjs'

import { DEFAULT_AWAIT_TIMEOUT_MS, parseDurationMs } from './duration.mjs'
import { awaitTasks, inspectTask, listTasksForOwner, ownerFromArgs } from './registry.mjs'

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
 * 写一条 async-task 工具回执。
 * @param {object} args 请求上下文
 * @param {string} name 工具名（点分命名，供宿主 shell 映射人类可读标题）
 * @param {string} content 回执文本
 * @param {boolean} [isError] 是否为错误
 * @param {object} [extra] 额外字段（结构化载荷，供宿主 shell 渲染可读 UI）
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
 * 取任务结果的可读文本（子代理运行取 `finalText`，其余按字符串/JSON 兜底）。
 * @param {object} task 任务
 * @returns {string} 结果文本
 */
function taskResultText(task) {
	const result = task?.result
	if (result == null) return ''
	if (typeof result === 'string') return result
	if (typeof result.finalText === 'string') return result.finalText
	if (typeof result.text === 'string') return result.text
	try { return JSON.stringify(result, null, '\t') }
	catch { return String(result) }
}

/**
 * 把等待结果格式化为工具回执文本。
 * @param {{ settled: object[], pending: string[], unknown: string[], timedOut: boolean }} result 等待结果
 * @param {'all' | 'any'} mode 等待模式
 * @returns {string} 回执文本
 */
function formatAwaitResult(result, mode) {
	const lines = [`等待结果（mode=${mode}${result.timedOut ? '，已超时' : ''}）：`]
	if (result.settled.length) {
		lines.push(`已完成（${result.settled.length}）：`)
		for (const task of result.settled) {
			const detail = task.state === 'failed'
				? `失败：${task.error?.message ?? '未知错误'}`
				: `结果：${echo(taskResultText(task), 2000)}`
			lines.push(`- ${task.id}（${task.kind}）：${detail}`)
		}
	}
	if (result.pending.length) lines.push(`仍在进行（${result.pending.length}）：${result.pending.join(', ')}`)
	if (result.unknown.length) lines.push(`未找到（${result.unknown.length}）：${result.unknown.join(', ')}`)
	if (result.settled.length === 0 && result.pending.length === 0 && result.unknown.length === 0)
		lines.push('（无匹配任务）')
	return lines.join('\n')
}

/**
 * `<list-async/>`：列出当前归属下进行中的异步任务。
 * @type {import('../../../../decl/pluginAPI.ts').ReplyHandler_t}
 */
export const listAsyncHandler = defineReplyHandler({
	tag: 'list-async',
	params: { kind: 'string' },
	/**
	 * 列出进行中的异步任务。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @param {object} call 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const owner = ownerFromArgs(args)
		const kind = call.params.kind ? String(call.params.kind).trim() : undefined
		const tasks = listTasksForOwner(owner, { kind })
		const view = tasks.map(task => ({
			id: task.id,
			kind: task.kind,
			label: task.label,
			startedAt: task.startedAt,
		}))
		if (!tasks.length) {
			writeToolLog(args, 'async-task.list', '当前没有进行中的异步任务。', false, {
				extension: { asyncList: { kind: kind ?? null, tasks: [] } },
			})
			return { regen: true }
		}
		const now = Date.now()
		const lines = tasks.map(task =>
			`- [${task.kind}] ${task.id}（已运行 ${msstr(now - task.startedAt)}）${task.label ? `：${task.label}` : ''}`
		)
		writeToolLog(args, 'async-task.list', `进行中的异步任务（${tasks.length}）：\n${lines.join('\n')}`, false, {
			extension: { asyncList: { kind: kind ?? null, tasks: view } },
		})
		return { regen: true }
	},
})

/**
 * `<await-async ids="..." mode="all|any" time-limit="..."/>`：等待一个或多个异步任务。
 * @type {import('../../../../decl/pluginAPI.ts').ReplyHandler_t}
 */
export const awaitAsyncHandler = defineReplyHandler({
	tag: 'await-async',
	params: { ids: 'string', mode: 'string', 'time-limit': 'string' },
	/**
	 * 等待异步任务。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @param {object} call 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const ids = String(call.params.ids ?? '').split(',').map(id => id.trim()).filter(Boolean)
		if (!ids.length) {
			writeToolLog(args, 'async-task.await', 'await-async 需要 ids（逗号分隔的任务 id）。', true)
			return { regen: true }
		}
		const mode = String(call.params.mode ?? '').trim().toLowerCase() === 'any' ? 'any' : 'all'
		const timeoutMs = parseDurationMs(call.params['time-limit']) ?? DEFAULT_AWAIT_TIMEOUT_MS
		try {
			const result = await awaitTasks(ids, { mode, timeoutMs, signal: args.generation_options?.signal, requester: ownerFromArgs(args) })
			writeToolLog(args, 'async-task.await', formatAwaitResult(result, mode), false, {
				extension: {
					asyncAwait: {
						mode,
						timedOut: result.timedOut,
						settled: result.settled.map(task => ({
							id: task.id,
							kind: task.kind,
							state: task.state,
							result: task.state === 'failed' ? '' : echo(taskResultText(task), 4000),
							error: task.state === 'failed' ? task.error?.message ?? '未知错误' : '',
						})),
						pending: result.pending,
						unknown: result.unknown,
					},
				},
			})
		}
		catch (error) {
			console.error('async-task: await-async 失败', error)
			writeToolLog(args, 'async-task.await', `等待异步任务失败：${error?.message ?? error}`, true)
		}
		return { regen: true }
	},
})

/**
 * 把检视载荷转成面向角色的文本。
 * @param {unknown} preview 检视载荷（字符串 / `{entries}` / 其它）
 * @returns {string} 文本
 */
function inspectPreviewText(preview) {
	if (preview == null) return '（无）'
	if (typeof preview === 'string') return preview
	if (Array.isArray(preview.entries)) {
		if (!preview.entries.length) return '（暂无对话）'
		return preview.entries.map(entry => `[${entry.role}] ${entry.name}: ${entry.content}`).join('\n---\n')
	}
	try { return JSON.stringify(preview, null, '\t') }
	catch { return String(preview) }
}

/**
 * 检视失败原因 → 面向角色的文案。
 * @param {'not_found'|'settled'|'forbidden'|'unsupported'} reason 失败原因
 * @param {string} id 任务 id
 * @returns {string} 文案
 */
function inspectFailureText(reason, id) {
	switch (reason) {
		case 'settled': return `异步任务 "${id}" 已结束，请在父生成循环结束前用 <await-async ids="${id}"/> 取回结果。`
		case 'forbidden': return `异步任务 "${id}" 不属于当前会话，无法检视。`
		case 'unsupported': return `异步任务 "${id}" 暂不支持检视。`
		default: return `未找到异步任务 "${id}"（可能已被取回、父生成已结束，或 id 有误）。`
	}
}

/**
 * `<inspect-async id="..."/>`：检视一个运行中的异步任务的最新进展（只读，不等待、不消费）。
 * @type {import('../../../../decl/pluginAPI.ts').ReplyHandler_t}
 */
export const inspectAsyncHandler = defineReplyHandler({
	tag: 'inspect-async',
	params: { id: 'string' },
	/**
	 * 检视运行中的异步任务。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @param {object} call 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const id = String(call.params.id ?? '').trim()
		if (!id) {
			writeToolLog(args, 'async-task.inspect', 'inspect-async 需要 id。', true)
			return { regen: true }
		}
		const result = inspectTask(id, ownerFromArgs(args))
		if (!result.ok) {
			writeToolLog(args, 'async-task.inspect', inspectFailureText(result.reason, id), true)
			return { regen: true }
		}
		const { task, preview } = result
		const head = `异步任务 ${task.id}（类型：${task.kind}，状态：${task.state}）${task.label ? `\n任务：${task.label}` : ''}`
		writeToolLog(args, 'async-task.inspect', `${head}\n\n最新进展：\n${inspectPreviewText(preview)}`, false, {
			extension: {
				asyncInspect: {
					id: task.id,
					kind: task.kind,
					state: task.state,
					label: task.label,
					rounds: preview?.rounds ?? null,
					roundLimit: preview?.roundLimit ?? null,
					entries: Array.isArray(preview?.entries) ? preview.entries : null,
					preview: Array.isArray(preview?.entries) ? null : typeof preview === 'string' ? echo(preview) : null,
				},
			},
		})
		return { regen: true }
	},
})

/** async-task 插件的完整 ReplyHandler 组。 */
export const asyncTaskReplyHandlers = defineReplyHandlers([
	listAsyncHandler,
	awaitAsyncHandler,
	inspectAsyncHandler,
])
