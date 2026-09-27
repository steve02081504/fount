/**
 * 【文件】src/public/parts/shells/chat/src/reply/roundContext.mjs
 * 【职责】轮次上下文刷新：regen 循环在下一轮 `StructCall` 前调用，把本轮期间新到达的权威时间线条目追加进 prompt_struct。
 * 【原理】`chat_log` 是唯一有序时间线（历史 + 本代 BeforeReply 工具日志、工具结果、原始生成、生成中 `Update` 到达的条目）；
 *   各 part 的 `additional_chat_log` 只是请求级上下文，每次构建重新生成，始终由 mergeStructPromptChatLog 拼在 chat_log 之后且从不封存。
 *   本函数每次调用都先登记当前 `chat_log` 的 id，再 `await args.Update()` 重读权威日志，按 id 去重后把新条目追加到时间线末尾。
 *   `consumeWakes`：表示角色已能看到本次读取时刻的权威日志，shell 的 `Update({ forRound: true })` 据此消费该槽位待触发唤醒；
 *   二级 prompt 构建（如 deep-research thinking）传 false，避免误消费主槽位的待触发唤醒。
 * 【数据结构】WeakMap<args, Set<string>> 记录本代已注入 id（即使 summarize 替换了 chat_log 仍能正确去重）。
 * 【关联】prompt_struct/index.mjs 的 mergeStructPromptChatLog；decl/chatLog.ts 的 Update；各 char 模板 regen 循环调用。
 */
/** @typedef {import('../../../../../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t */

/** 每个请求本代已注入过的日志 id。 @type {WeakMap<object, Set<string>>} */
const injectedIds = new WeakMap()

/**
 * 取条目的去重键（优先 `id`，回退 DAG `eventId`）。
 * @param {chatLogEntry_t | undefined} entry 日志条目
 * @returns {string} 去重键（无则为空串）
 */
function entryKey(entry) {
	return String(entry?.id ?? entry?.extension?.chat?.eventId ?? '')
}

/**
 * 递归登记一组条目的去重键。
 * @param {Set<string>} seen 去重集合
 * @param {chatLogEntry_t[] | undefined} entries 条目
 * @returns {void}
 */
function rememberEntries(seen, entries) {
	for (const entry of entries || []) {
		const key = entryKey(entry)
		if (key) seen.add(key)
		rememberEntries(seen, entry?.logContextBefore)
		rememberEntries(seen, entry?.logContextAfter)
	}
}

/**
 * 轮次上下文刷新：登记当前时间线，并追加 `args.Update()` 返回的新条目。
 * @param {object} args 请求上下文（需含 `Update` 才可采集新条目）
 * @param {object} prompt_struct 提示结构
 * @param {object} [options] 选项
 * @param {boolean} [options.consumeWakes] 是否让 shell 消费该槽位待触发唤醒（默认 true；二级 prompt 构建传 false）
 * @returns {Promise<void>}
 */
export async function injectRoundEntries(args, prompt_struct, options = {}) {
	const { consumeWakes = true } = options
	if (!prompt_struct?.chat_log) return

	let seen = injectedIds.get(args)
	if (!seen) {
		seen = new Set()
		injectedIds.set(args, seen)
	}
	// 每次调用都登记：上一次调用之后新追加的本代时间线条目也要纳入去重
	rememberEntries(seen, prompt_struct.chat_log)

	if (typeof args?.Update !== 'function') return

	let fresh
	try {
		fresh = await args.Update(consumeWakes ? { forRound: true } : {})
	}
	catch {
		return
	}
	if (!Array.isArray(fresh?.chat_log)) return
	for (const entry of fresh.chat_log) {
		const key = entryKey(entry)
		if (key && seen.has(key)) continue
		if (key) seen.add(key)
		prompt_struct.chat_log.push(entry)
	}
}
