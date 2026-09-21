/**
 * 【文件】handler.mjs — `<compress-context/>` 的 ReplyHandler
 * 【职责】接收角色手动发出的 `<compress-context/>`，调用 summarize 的 compressContext 压缩历史；成功则请求 regen，失败则写一条工具日志说明原因。
 * 【原理】无参自闭合标签，一次调用即尝试压缩一次。真正的双重压缩防护由 compressContext 内部的 WeakSet 负责，本模块不重复实现；
 *   仅负责缺失 AI 源等前置判断与面向角色的可读反馈。成功时 summary 条目已由 compressContext 写入 result.logContextBefore 并收敛 prompt_struct。
 * 【数据结构】工具日志条目 = { name, role: 'tool', content, content_for_show, files }。
 * 【关联】summarize.mjs（compressContext）、defineReplyHandler.mjs、prompt.mjs、state.mjs。
 */
/**
 * @typedef {import('../../../../decl/pluginAPI.ts').ReplyHandler_t} ReplyHandler_t
 * @typedef {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} chatReplyRequest_t
 */

import { compressContext } from '../../shells/chat/src/chat/session/summarize.mjs'
import { defineReplyHandler } from '../../shells/chat/src/reply/defineReplyHandler.mjs'

import { prefersChinese } from './state.mjs'

/** 工具日志的 name 标签。 */
const TOOL_NAME = 'context-compress'

/** 面向角色的过程文案（中 / 英）。 */
const MESSAGES = {
	zh: {
		noSource: '上下文压缩未执行：当前会话没有可用的 AI 源，无法生成摘要。',
		noResult: '上下文压缩未执行：没有可压缩的新对话内容（可能本轮已压缩过、历史为空，或摘要生成失败）。',
	},
	en: {
		noSource: 'Context compression was not run: this session has no available AI source, so no summary can be generated.',
		noResult: 'Context compression was not run: there is no new compressible history (it may already have been compressed this round, the history may be empty, or summarisation failed).',
	},
}

/**
 * 写入一条角色可见的工具结果日志；缺少 `AddLongTimeLog`（如独立调用）时静默跳过。
 * @param {object} args 请求上下文（含 `AddLongTimeLog`）
 * @param {string} content 面向角色的日志正文
 * @returns {void}
 */
function writeToolLog(args, content) {
	args?.AddLongTimeLog?.({
		name: TOOL_NAME,
		role: 'tool',
		content,
		content_for_show: content,
		files: [],
	})
}

/**
 * `<compress-context/>`：手动触发一次上下文压缩。
 *
 * 成功生成摘要条目时返回 `{ regen: true }`（下一轮会携带摘要重新生成）；否则写一条工具日志且不返回结果。
 * @type {ReplyHandler_t}
 */
export const compressContextReplyHandler = defineReplyHandler({
	tag: 'compress-context',
	name: TOOL_NAME,
	/**
	 * 处理一次 `<compress-context/>` 调用。
	 * @param {object} reply 本轮回复对象（`logContextBefore` 为压缩结果的落点）
	 * @param {chatReplyRequest_t & { prompt_struct?: object, AddLongTimeLog?: Function }} args 请求上下文
	 * @returns {Promise<{ regen?: boolean } | void>} 成功时 `{ regen: true }`，否则无返回值
	 */
	handle: async (reply, args) => {
		const messages = prefersChinese(args?.locales) ? MESSAGES.zh : MESSAGES.en
		const aiSource = args?.ai_source
		if (!aiSource?.Call) {
			writeToolLog(args, messages.noSource)
			return
		}
		if (!args?.prompt_struct) {
			writeToolLog(args, messages.noResult)
			return
		}

		const entry = await compressContext({
			args,
			aiSource,
			prompt_struct: args.prompt_struct,
			result: reply,
		})
		if (entry) return { regen: true }
		writeToolLog(args, messages.noResult)
	},
})
