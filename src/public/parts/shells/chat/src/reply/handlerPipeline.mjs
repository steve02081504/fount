/**
 * 【文件】src/reply/handlerPipeline.mjs
 * 【职责】统一驱动 ReplyHandler 链：按 level 分组，在每个分组内按「内容型先跑、标签调用按生成文本顺序」逐个解析执行，聚合是否重新生成，并把本轮原始生成作为 char 日志追加。
 * 【原理】level 越小越先；同一 level 内先跑无 tag 的内容型 handler，再对带 tag/pattern 者取「最靠前的未消耗调用」整段执行——容器标签整段消耗，天然防止内层标签被单独触发，跨插件也保持文本顺序。无 fixpoint。
 *   声明了 `parallel` 的 handler 之间可并发：`parallel: true` 与所有启用并行者兼容，`parallel: string[]` 只与列出的 handler 名兼容（需双向）；同组内文本相邻的兼容调用并发执行，未声明者视为屏障串行。并行批次的工具日志按文本顺序回放，保证确定性。
 *   提前求值（evaluate）结果按 name 缓存在 `args.extension.evaluatedToolCalls`，签名变化（重生成）即重置；展示层由 `display` 纯派生，handler 不得直接改写整条 content_for_show。
 * 【数据结构】call = { name, tag, params, body, raw, start, end, occurrence, value?, error? }；handler 返回 { regen?, content?, stop? }。
 * 【关联】被 ZL-31 / GentianAphrodite / ImportHandlers / easynew 模板与各插件 handler 使用；类型见 decl/pluginAPI.ts。
 */
/** @typedef {import('../../../../../../decl/chatLog.ts').chatReply_t} chatReply_t */
/** @typedef {import('../../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t */
/** @typedef {import('../../../../../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t */
/** @typedef {import('../../../../../../decl/pluginAPI.ts').ReplyHandler_t} ReplyHandler_t */
/** @typedef {import('../../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { truncateOutput } from '../../../../../../scripts/shell_guard.mjs'

import { collectHandlerCalls } from './collectCalls.mjs'
import { flattenReplyHandlers } from './defineReplyHandler.mjs'
import { padBlockRendered, renderCallDisplay } from './display.mjs'
import { getEvaluationCache, syncEvaluationCache } from './evaluationCache.mjs'

/** 单轮生成内最多处理的调用数，防御 handler 不断产生新匹配导致的死循环。 */
const MAX_HANDLED_CALLS = 256
/** 处理后回执中，每个 inline 结果的长度上限（头尾各留一半）。 */
const INLINE_RESULT_REPORT_LIMIT = 2000

/**
 * 构造本轮原始生成对应的 char 日志条目（保留原始生成与思考，人类展示层用最终 show）。
 * @param {chatReply_t} result 本轮生成的回复对象
 * @param {chatReplyRequest_t & { prompt_struct?: prompt_struct_t }} args 请求上下文
 * @returns {chatLogEntry_t} 原始生成日志条目
 */
function buildRawGenerationEntry(result, args) {
	const extension = {}
	if (result.extension?.reasoning_content) extension.reasoning_content = result.extension.reasoning_content
	if (result.extension?.reasoning_summary) extension.reasoning_summary = result.extension.reasoning_summary
	return {
		name: args.Charname,
		uid: args.CharUid,
		role: 'char',
		content: result.content ?? '',
		content_for_show: result.content_for_show ?? result.content ?? '',
		files: [],
		charVisibility: [args.char_id],
		extension,
	}
}

/**
 * 判定两个 handler 是否互不冲突、可并发执行。
 *
 * `parallel: true` 表示与任何启用并行的 handler 兼容；`parallel: string[]` 只与列出的 handler 名兼容。
 * 跨 handler 需双向兼容；同一 handler 的多次调用只要启用了并行即可并发。
 * @param {object} handlerA handler A
 * @param {object} handlerB handler B
 * @returns {boolean} 是否可并发
 */
function canRunParallel(handlerA, handlerB) {
	if (handlerA === handlerB) return true
	if (!handlerA.parallel || !handlerB.parallel) return false
	const aAllowsB = handlerA.parallel === true || handlerA.parallel.includes(handlerB.name)
	const bAllowsA = handlerB.parallel === true || handlerB.parallel.includes(handlerA.name)
	return aAllowsB && bAllowsA
}

/**
 * 生成收集日志的 `AddLongTimeLog`（用于并行批次按文本顺序回放）。
 * @param {chatLogEntry_t[]} buffer 缓冲数组
 * @returns {(entry: chatLogEntry_t) => void} 收集器
 */
function createLogCollector(buffer) {
	return entry => { buffer.push(entry) }
}

/**
 * 找出文本中 cursor 之后最靠前的未消耗调用（同一位置时按 handler 声明顺序取先者）。
 * @param {string} content 当前解析文本
 * @param {object[]} handlers 本组 handler
 * @param {number} cursor 已消耗到的位置
 * @param {object} args 请求上下文
 * @returns {{ handler: object, call: object } | null} 最靠前的调用
 */
function findEarliestCall(content, handlers, cursor, args) {
	let best = null
	for (const handler of handlers) {
		if (!handler.pattern) continue
		for (const call of collectHandlerCalls(content, handler, args)) {
			if (call.start < cursor) continue
			if (!best || call.start < best.call.start) best = { handler, call }
		}
	}
	return best
}

/**
 * 同步提前求值缓存并返回该调用的缓存条目。
 * @param {string} content 当前解析文本
 * @param {object} handler handler
 * @param {object} call 调用对象
 * @param {object} args 请求上下文
 * @param {object} handlerArgs handler 参数
 * @returns {object | null} 求值条目（无 evaluate 时为 null）
 */
function prepareCallEvaluation(content, handler, call, args, handlerArgs) {
	if (!handler.evaluate) return null
	const calls = collectHandlerCalls(content, handler, handlerArgs)
	const cache = getEvaluationCache(args, handler.name)
	syncEvaluationCache(cache, calls, handler.evaluate, handlerArgs)
	return cache.entries[call.occurrence]
}

/**
 * 运行一轮生成后的 ReplyHandler 链。
 *
 * - 按 `level` 升序分组（同值一组）；组内先跑内容型 handler（声明序），再对标签调用按生成文本顺序整段执行；
 * - 声明 `parallel` 的 handler 之间可并发（`true`=与所有启用并行者兼容；字符串数组=只与列出的 handler 名双向兼容）；未声明者串行；
 * - 内容型 handler 无 `pattern`，`handle(reply, args, null)` 作用于整条 `reply.content`；
 * - handler 返回 `{ regen?, content?, stop? }`：`regen` 建议下一轮生成，`content` 整条替换 `reply.content`，`stop` 立即终止本轮；
 * - `evaluate` 的提前求值结果经 `args.extension.evaluatedToolCalls` 缓存并在 `call.value` 复用；
 * - 展示层由 `display` 纯派生：把已处理调用段替换为其最终展示文本，handler 不直接改写整条 `content_for_show`；
 * - 声明 `evaluate` 的 handler 视为 inline 类：管线把每个 inline 结果分别截断，追加一条工具日志告知角色其消息经处理后的样子；
 * - 若建议重新生成，则把本轮原始生成（含思考）作为 char 日志插入到本轮工具结果之前。
 * @param {chatReply_t} result 当前这轮 AI 回复
 * @param {chatReplyRequest_t & { prompt_struct: prompt_struct_t, AddLongTimeLog?: (entry: chatLogEntry_t) => void }} args 请求上下文
 * @param {ReplyHandler_t[]} handlers 回复处理器链
 * @returns {Promise<boolean>} 是否建议发起下一轮生成
 */
export async function runReplyHandlers(result, args, handlers) {
	const executor = flattenReplyHandlers(handlers)
	const contextLog = result.logContextBefore ??= []
	const promptLog = args.prompt_struct?.char_prompt?.additional_chat_log

	/**
	 * 默认日志写入：char/user 角色自动补 uid，并默认仅对本角色可见。
	 * @param {chatLogEntry_t} entry 聊天日志条目
	 * @returns {void}
	 */
	function defaultAddLongTimeLog(entry) {
		entry.uid ??= entry.role === 'char' ? args.CharUid
			: entry.role === 'user' ? args.UserUid
				: 'system'
		entry.charVisibility ??= [args.char_id]
		contextLog.push(entry)
		promptLog?.push(entry)
	}
	const AddLongTimeLog = args.AddLongTimeLog ?? defaultAddLongTimeLog
	const handlerArgs = { ...args, AddLongTimeLog }

	const logStart = contextLog.length
	const promptStart = promptLog?.length ?? 0

	// 按 level 升序稳定分组
	const ordered = executor
		.map((handler, index) => ({ handler, index }))
		.sort((a, b) => a.handler.level - b.handler.level || a.index - b.index)
	const groups = []
	for (const item of ordered) {
		const last = groups.at(-1)
		if (last && last.level === item.handler.level) last.handlers.push(item.handler)
		else groups.push({ level: item.handler.level, handlers: [item.handler] })
	}

	let wantRegen = false
	let stopped = false
	let handledCount = 0
	const originalContent = result.content
	/** @type {Array<{ raw: string, displayText: string, inline: boolean }>} 已处理调用段的展示替换。 */
	const handledSpans = []

	for (const group of groups) {
		if (stopped) break

		// 1) 内容型 handler：整条 content，先于同组标签调用
		for (const handler of group.handlers) {
			if (handler.pattern) continue
			const outcome = await handler.handle(result, handlerArgs, null) ?? {}
			if (outcome.content !== undefined) result.content = outcome.content
			if (outcome.regen) wantRegen = true
			if (outcome.stop) { stopped = true; break }
		}
		if (stopped) break

		// 2) 标签/模式 handler：按当前 content 中最早的未消耗调用逐个/并发执行
		let content = result.content ?? ''
		let cursor = 0
		while (handledCount < MAX_HANDLED_CALLS) {
			const head = findEarliestCall(content, group.handlers, cursor, handlerArgs)
			if (!head) break

			// 收集一段文本相邻、互相声明不冲突的可并行调用
			let batch = null
			if (head.handler.parallel) {
				batch = [head]
				let scanCursor = head.call.end
				while (handledCount + batch.length < MAX_HANDLED_CALLS) {
					const next = findEarliestCall(content, group.handlers, scanCursor, handlerArgs)
					if (!next?.handler.parallel) break
					if (!batch.every(item => canRunParallel(next.handler, item.handler))) break
					batch.push(next)
					scanCursor = next.call.end
				}
			}

			if (batch && batch.length > 1) {
				// 并发批次：先并发启动求值，再并发执行；日志按文本顺序回放，保证确定性
				const entries = batch.map(item => prepareCallEvaluation(content, item.handler, item.call, args, handlerArgs))
				await Promise.all(entries.map(entry => entry?.promise))
				batch.forEach((item, index) => {
					item.call.value = entries[index]?.value
					item.call.error = entries[index]?.error
				})
				const bufferedLogs = batch.map(() => [])
				const outcomes = await Promise.all(batch.map((item, index) =>
					Promise.resolve(item.handler.handle(result, {
						...handlerArgs,
						AddLongTimeLog: createLogCollector(bufferedLogs[index]),
					}, item.call)).then(outcome => outcome ?? {})
				))
				let batchStop = false
				for (let index = 0; index < batch.length; index++) {
					for (const entry of bufferedLogs[index]) AddLongTimeLog(entry)
					const outcome = outcomes[index]
					if (outcome.content !== undefined) result.content = outcome.content
					if (outcome.regen) wantRegen = true
					const { handler, call } = batch[index]
					const displayText = renderCallDisplay(handler, call, {
						stage: 'final', open: false, value: call.value, error: call.error,
					}, handlerArgs)
					handledSpans.push({ raw: call.raw, displayText, inline: Boolean(handler.evaluate) && Boolean(displayText) })
					handledCount++
					if (outcome.stop) batchStop = true
				}
				cursor = batch.at(-1).call.end
				if (result.content !== content) { content = result.content ?? ''; cursor = 0 }
				if (batchStop) { stopped = true; break }
				continue
			}

			// 顺序执行单个调用
			handledCount++
			const { handler, call } = head
			const entry = prepareCallEvaluation(content, handler, call, args, handlerArgs)
			await entry?.promise
			call.value = entry?.value
			call.error = entry?.error

			const beforeContent = result.content
			const outcome = await handler.handle(result, handlerArgs, call) ?? {}
			if (outcome.content !== undefined) result.content = outcome.content
			if (outcome.regen) wantRegen = true

			const displayText = renderCallDisplay(handler, call, {
				stage: 'final', open: false, value: call.value, error: call.error,
			}, handlerArgs)
			handledSpans.push({ raw: call.raw, displayText, inline: Boolean(handler.evaluate) && Boolean(displayText) })

			if (outcome.stop) { stopped = true; break }
			if (result.content !== beforeContent) { content = result.content ?? ''; cursor = 0 }
			else cursor = call.end
		}
		if (stopped) break
	}

	if (handledCount >= MAX_HANDLED_CALLS)
		console.warn(`runReplyHandlers 达到单轮调用上限 ${MAX_HANDLED_CALLS}，剩余调用已跳过。`)

	// 展示层纯派生：在现有 show（含角色自定义变换）上把已处理调用段替换为其展示文本；
	// 若本轮 handler 整条替换了 content（如 rolesettingfilter 封禁），则 show 必须从新 content 重新派生，避免泄漏旧内容。
	const contentReplaced = result.content !== originalContent
	if (handledSpans.length || contentReplaced) {
		let show = contentReplaced ? result.content ?? '' : result.content_for_show ?? result.content ?? ''
		for (const span of handledSpans)
			show = show.replace(span.raw, (raw, index) => padBlockRendered(show, index, index + raw.length, span.displayText))
		result.content_for_show = show
	}

	// inline 回执：声明 `evaluate` 的 handler 视为 inline 类；把每个 inline 结果分别截断后告知角色其消息变成了什么样子。
	// 结果与原文相同（无可见变化）的块不回执；全部无变化则整条省略。
	const inlineSpans = handledSpans.filter(span => span.inline && span.displayText !== span.raw)
	if (inlineSpans.length) {
		const lines = inlineSpans.map(span => {
			const { text, truncated, omitted } = truncateOutput(span.displayText, {
				limit: INLINE_RESULT_REPORT_LIMIT,
				head: INLINE_RESULT_REPORT_LIMIT / 2,
				tail: INLINE_RESULT_REPORT_LIMIT / 2,
			})
			return `${span.raw}\n→ ${text}${truncated ? `\n（中间省略 ${omitted} 字符）` : ''}`
		})
		AddLongTimeLog({
			name: 'inline-rendered',
			role: 'tool',
			content: `你的消息中以下 inline 调用已被处理并替换为对应结果：\n\n${lines.join('\n\n')}`,
			files: [],
		})
	}

	if (wantRegen && !stopped) {
		const rawEntry = buildRawGenerationEntry(result, args)
		contextLog.splice(logStart, 0, rawEntry)
		promptLog?.splice(promptStart, 0, rawEntry)
	}

	return wantRegen && !stopped
}
