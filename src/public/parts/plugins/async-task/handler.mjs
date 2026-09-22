/**
 * 【文件】src/public/parts/plugins/async-task/handler.mjs
 * 【职责】async-task 插件的 ReplyHandler 组：解析 `<list-async>` / `<await-async>` 两个统一异步工具标签。
 * 【原理】标签层只做参数解析与工具回执；真正的任务注册表、等待与通知在 registry.mjs。
 * 【数据结构】handler = defineReplyHandler(...)；`<await-async ids="a,b" mode="all|any" time-limit="5m"/>`。
 * 【关联】registry.mjs 的 listTasks / awaitTasks；prompt.mjs 注入说明；main.mjs 汇总为 ReplyHandler。
 */
import { defineReplyHandler, defineReplyHandlers } from '../../shells/chat/src/reply/defineReplyHandler.mjs'

import { DEFAULT_AWAIT_TIMEOUT_MS, parseDurationMs } from './duration.mjs'
import { awaitTasks, listTasks, ownerFromArgs } from './registry.mjs'

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
 * 把毫秒格式化为简短耗时文本。
 * @param {number} ms 毫秒数
 * @returns {string} 如 `12s` / `3m5s`
 */
function formatElapsed(ms) {
	const sec = Math.max(0, Math.round(ms / 1000))
	if (sec < 60) return `${sec}s`
	return `${Math.floor(sec / 60)}m${sec % 60}s`
}

/**
 * 写一条 async-task 工具回执。
 * @param {object} args 请求上下文
 * @param {string} content 回执文本
 * @param {boolean} [isError] 是否为错误
 * @returns {void}
 */
function writeToolLog(args, content, isError = false) {
	args.AddLongTimeLog?.({
		name: 'async-task',
		role: 'tool',
		content,
		content_for_show: content,
		files: [],
		...isError ? { extension: { error: true } } : {},
	})
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
				: `结果：${echo(String(task.result ?? ''), 2000)}`
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
		const tasks = listTasks({
			username: owner.username,
			charId: owner.charId,
			chatName: owner.chatName,
			parentRunId: owner.parentRunId,
			kind,
		})
		if (!tasks.length) {
			writeToolLog(args, '当前没有进行中的异步任务。')
			return { regen: true }
		}
		const now = Date.now()
		const lines = tasks.map(task =>
			`- [${task.kind}] ${task.id}（已运行 ${formatElapsed(now - task.startedAt)}）${task.label ? `：${task.label}` : ''}`
		)
		writeToolLog(args, `进行中的异步任务（${tasks.length}）：\n${lines.join('\n')}`)
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
			writeToolLog(args, 'await-async 需要 ids（逗号分隔的任务 id）。', true)
			return { regen: true }
		}
		const mode = String(call.params.mode ?? '').trim().toLowerCase() === 'any' ? 'any' : 'all'
		const timeoutMs = parseDurationMs(call.params['time-limit']) ?? DEFAULT_AWAIT_TIMEOUT_MS
		try {
			const result = await awaitTasks(ids, { mode, timeoutMs, signal: args.generation_options?.signal })
			writeToolLog(args, formatAwaitResult(result, mode))
		}
		catch (error) {
			console.error('async-task: await-async 失败', error)
			writeToolLog(args, `等待异步任务失败：${error?.message ?? error}`, true)
		}
		return { regen: true }
	},
})

/** async-task 插件的完整 ReplyHandler 组。 */
export const asyncTaskReplyHandlers = defineReplyHandlers([
	listAsyncHandler,
	awaitAsyncHandler,
])
