/**
 * 【文件】src/reply/handlerPipeline.mjs
 * 【职责】统一驱动 ReplyHandler 链：在独立的 `content_for_handle` 工作副本上解析工具调用，掩除已处理段，聚合是否建议重新生成；并把每轮原始生成（含思考）作为 char 日志追加。
 * 【原理】每轮生成后从 `result.content` 派生 `content_for_handle`；反复跑 handler 直到副本不再变化（fixpoint），以支持「多个工具依次处理完毕后再进行下一轮生成」并避免工具 A 的参数触发工具 B；handler 返回 true 仅表示建议下一轮生成。
 * 【数据结构】`result.content_for_handle`（临时）、`args.MaskHandledCall`、`result.logContextBefore` / `prompt_struct.char_prompt.additional_chat_log`（原始生成入日志）。
 * 【关联】被 ZL-31 / GentianAphrodite / ImportHandlers / easynew 模板与各插件 handler 使用；类型见 decl/pluginAPI.ts。
 */
/** @typedef {import('../../../../../../decl/chatLog.ts').chatReply_t} chatReply_t */
/** @typedef {import('../../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t */
/** @typedef {import('../../../../../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t */
/** @typedef {import('../../../../../../decl/pluginAPI.ts').ReplyHandler_t} ReplyHandler_t */
/** @typedef {import('../../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

/** 单轮 handler 链最多重复次数，防御 handler 不断产生新匹配导致的死循环。 */
const MAX_HANDLER_PASSES = 32

/**
 * 构造本轮原始生成对应的 char 日志条目（保留原始生成与思考信息）。
 *
 * 人类展示层（`content_for_show`）同时掩除本轮已处理的工具调用段：这些调用已由
 * 工具结果条目（工具卡）单独呈现，原始标签不应再泄漏到界面（否则会以裸 HTML
 * 形式显示标签内文，或留下无意义的空气泡）。
 * @param {chatReply_t} result 本轮生成的回复对象
 * @param {chatReplyRequest_t & { prompt_struct?: prompt_struct_t }} args 请求上下文
 * @param {Array<[string, string]>} maskedSegments 已掩除的调用段与替换文本
 * @returns {chatLogEntry_t} 原始生成日志条目
 */
function buildRawGenerationEntry(result, args, maskedSegments) {
	const extension = {}
	if (result.extension?.reasoning_content) extension.reasoning_content = result.extension.reasoning_content
	if (result.extension?.reasoning_summary) extension.reasoning_summary = result.extension.reasoning_summary
	let show = result.content_for_show ?? result.content
	if (show != null && maskedSegments.length)
		for (const [segment, replacement] of maskedSegments)
			show = show.split(segment).join(replacement)
	return {
		name: args.Charname,
		uid: args.CharUid,
		role: 'char',
		content: result.content ?? '',
		content_for_show: show,
		files: [],
		charVisibility: [args.char_id],
		extension,
	}
}

/**
 * 运行一轮生成后的 ReplyHandler 链。
 *
 * - 在 `result.content_for_handle` 上解析（不改写原始 `result.content`）；
 * - handler 命中后应调用 `args.MaskHandledCall(match[0])` 掩除已处理段；
 * - handler 返回 true 表示建议下一轮生成，返回 false 表示不发起（本轮生成即可作为最终结果）；
 * - 若最终建议重新生成，则把本轮原始生成（含思考）作为 char 日志插入到本轮工具结果之前，
 *   并同步剔除已掩除的工具调用段（人类展示层不再泄漏原始标签）。
 * @param {chatReply_t} result 当前这轮 AI 回复
 * @param {chatReplyRequest_t & { prompt_struct: prompt_struct_t, AddLongTimeLog?: (entry: chatLogEntry_t) => void }} args 请求上下文
 * @param {ReplyHandler_t[]} handlers 回复处理器链（顺序即处理顺序，容器型工具应排在内层工具之前）
 * @returns {Promise<boolean>} 是否建议发起下一轮生成
 */
export async function runReplyHandlers(result, args, handlers) {
	const executor = handlers.filter(Boolean)
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

	/** @type {Array<[string, string]>} 本轮掩除的调用段（含替换文本），供人类展示层同步剔除。 */
	const maskedSegments = []

	/**
	 * 从 `content_for_handle` 掩除一个已处理的调用段（替换为无害内容），
	 * 防止其参数被后续 handler 误判为另一工具的调用。
	 * @param {string} segment 已处理的调用段原文
	 * @param {string} [replacement] 无害替换内容（默认换行）
	 * @returns {void}
	 */
	const MaskHandledCall = (segment, replacement = '\n') => {
		if (!segment) return
		result.content_for_handle = result.content_for_handle.replace(segment, replacement)
		maskedSegments.push([segment, replacement])
	}

	const handlerArgs = { ...args, AddLongTimeLog, MaskHandledCall }
	const logStart = contextLog.length
	const promptStart = promptLog?.length ?? 0

	result.content_for_handle = result.content ?? ''
	let wantRegen = false
	for (let pass = 0; pass < MAX_HANDLER_PASSES; pass++) {
		const before = result.content_for_handle
		for (const handler of executor)
			if (await handler(result, handlerArgs))
				wantRegen = true
		if (result.content_for_handle === before) break
	}

	if (wantRegen) {
		const rawEntry = buildRawGenerationEntry(result, args, maskedSegments)
		contextLog.splice(logStart, 0, rawEntry)
		promptLog?.splice(promptStart, 0, rawEntry)
	}

	delete result.content_for_handle
	return wantRegen
}
