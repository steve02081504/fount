/**
 * 【文件】src/streaming/replyPreviews.mjs
 * 【职责】ReplyHandler 的流式预览 SSOT：解析各 handler 的标签调用，将未完成调用渲染为占位、已求值调用渲染为结果，并驱动提前求值缓存。
 * 【原理】与回复管线共用同一批 handler 与 `display`/`evaluate`：从原始 `content` 派生 show，整段替换每个已完成调用；
 *   尾部的未闭合标签按 `state.open` 渲染占位。evaluate 在此启动、缓存于 `args.extension.evaluatedToolCalls`，后续 chunk 与管线复用。
 * 【数据结构】handler.pattern = { tag, params, body }；state = { stage:'streaming', open, value?, error? }。
 * 【关联】被 char 插件与其它 shell 直接 import；替代旧 defineToolUseBlocks / defineInlineToolUses；渲染见 reply/display.mjs。
 */
import { buildHandlerCall, collectHandlerCalls } from '../reply/collectCalls.mjs'
import { flattenReplyHandlers } from '../reply/defineReplyHandler.mjs'
import { padBlockRendered, renderCallDisplay, renderToolCallingPlaceholder } from '../reply/display.mjs'
import { getEvaluationCache, readEvaluatedCall, syncEvaluationCache } from '../reply/evaluationCache.mjs'
import { findOpenTag } from '../tags/index.mjs'

/**
 * 在 show 中就地替换首个匹配的原始调用段，按需补行边界。
 * @param {string} show 当前展示文本
 * @param {string} raw 原始调用段
 * @param {string} displayText 展示文本
 * @returns {string} 替换后展示文本
 */
function replaceCallSpan(show, raw, displayText) {
	const index = show.indexOf(raw)
	if (index < 0) return show
	return show.slice(0, index)
		+ padBlockRendered(show, index, index + raw.length, displayText)
		+ show.slice(index + raw.length)
}

/**
 * 在文本尾部找出「正在输入中的起始标签」（`<run-js` / `<view-file ` 等尚未出现 `>`）。
 *
 * 只对已注册的工具标签生效：`<` 后紧跟的名字是某标签的前缀或完整名，且其后到文本末尾再无 `>`。
 * 这样流式到半截标签时展示层不会把 XML 原文漏给用户，同时不误伤普通文本里的尖括号。
 * @param {string} content 当前生成文本
 * @param {string[]} tags 已注册的标签名
 * @returns {{ start: number, end: number, raw: string } | null} 半截标签范围
 */
function findPartialOpenTag(content, tags) {
	const start = content.lastIndexOf('<')
	if (start < 0) return null
	const tail = content.slice(start)
	const match = /^<([a-zA-Z][\w.-]*)([^>]*)$/.exec(tail)
	if (!match) return null
	const name = match[1].toLowerCase()
	const isKnown = tags.some(tag => {
		const lower = tag.toLowerCase()
		return name === lower || lower.startsWith(name)
	})
	if (!isKnown) return null
	return { start, end: content.length, raw: tail }
}

/**
 * 构造回复预览更新器：由 handler 声明的标签自动派生预览。
 *
 * 展示层以来源已生成的 `content_for_show`（如 AI 源的推理 details）为起点，
 * 只替换本 handler 能识别的调用段；这样多个预览更新器串联时不会互相把对方的展示层重建掉。
 * @param {object | object[]} handlers 规范化的 ReplyHandler（叶子、组合节点或它们的列表）
 * @returns {(next?: Function) => Function} 预览更新器工厂
 */
export function defineReplyPreviews(handlers) {
	const ordered = flattenReplyHandlers(handlers)
		.map((handler, index) => ({ handler, index }))
		.sort((a, b) => a.handler.level - b.handler.level || a.index - b.index)
		.map(item => item.handler)
	const tagNames = ordered
		.map(handler => handler.pattern)
		.filter(pattern => pattern && !(pattern instanceof RegExp) && typeof pattern !== 'function' && pattern.tag)
		.map(pattern => pattern.tag)
	return next => (args, reply) => {
		const content = reply.content ?? ''
		let show = reply.content_for_show ?? content
		for (const handler of ordered) {
			const pattern = handler.pattern
			if (!pattern || pattern instanceof RegExp || typeof pattern === 'function' || !pattern.tag) continue
			const calls = collectHandlerCalls(content, handler, args)
			const cache = handler.evaluate ? getEvaluationCache(args, handler.name) : null
			if (cache) syncEvaluationCache(cache, calls, handler.evaluate, args)
			for (const call of calls) {
				const entry = cache ? readEvaluatedCall(cache, call.occurrence) : null
				const displayText = renderCallDisplay(handler, call, {
					stage: 'streaming', open: false, value: entry?.value, error: entry?.error,
				}, args)
				show = replaceCallSpan(show, call.raw, displayText)
			}
			const openCall = findOpenTag(content, pattern.tag)
			if (openCall) {
				const call = buildHandlerCall(handler, openCall, openCall.occurrence)
				const displayText = renderCallDisplay(handler, call, {
					stage: 'streaming', open: true,
				}, args)
				show = replaceCallSpan(show, call.raw, displayText)
			}
		}
		const partial = findPartialOpenTag(content, tagNames)
		if (partial) show = replaceCallSpan(show, partial.raw, renderToolCallingPlaceholder(args))
		reply.content_for_show = show
		next?.(args, reply)
	}
}
