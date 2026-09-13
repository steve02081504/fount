/**
 * 【文件】src/reply/collectCalls.mjs
 * 【职责】把文本按某 ReplyHandler 的 pattern 收集为完整调用对象（附 name/params/body/occurrence）。
 * 【原理】`{ tag, params, body }` 走统一标签解析库；其余逃生口（RegExp / {start,end} / 函数）走 collectPatternCalls。
 *   返回顺序即出现顺序，occurrence 用于对齐提前求值缓存。
 * 【数据结构】call = { name, tag?, params, body, raw, start, end, inner, occurrence, match?, groups? }。
 * 【关联】被 reply/handlerPipeline.mjs 与 streaming/replyPreviews.mjs 共用；解析见 tags/index.mjs。
 */
import { collectPatternCalls, collectTagCalls, parseBody, parseParams } from '../tags/index.mjs'

/**
 * 由原始命中构造规范调用对象。
 * @param {object} handler 规范化的 ReplyHandler
 * @param {object} rawCall 原始命中（tags 或 pattern）
 * @param {number} index 出现序号
 * @returns {object} 规范调用对象
 */
export function buildHandlerCall(handler, rawCall, index) {
	const pattern = handler.pattern
	const call = { name: handler.name, ...rawCall, occurrence: rawCall.occurrence ?? index }
	if (pattern && !(pattern instanceof RegExp) && typeof pattern !== 'function' && pattern.tag) {
		call.tag = pattern.tag
		call.params = parseParams(pattern.params, rawCall.attrs)
		call.body = parseBody(pattern.body, rawCall.inner, call)
	}
	else {
		call.params = {}
		call.body = rawCall.inner
	}
	return call
}

/**
 * 收集某 handler 在给定文本上的全部完整调用。
 * @param {string} content 待解析文本
 * @param {object} handler 规范化的 ReplyHandler
 * @param {object} args 请求上下文
 * @returns {object[]} 调用列表
 */
export function collectHandlerCalls(content, handler, args) {
	const pattern = handler.pattern
	if (!pattern) return []
	const isTag = !(pattern instanceof RegExp) && typeof pattern !== 'function' && pattern.tag
	const rawCalls = isTag
		? collectTagCalls(content, pattern.tag)
		: collectPatternCalls(content, pattern, args)
	return rawCalls.map((rawCall, index) => buildHandlerCall(handler, rawCall, index))
}
