/**
 * 【文件】src/public/parts/shells/chat/src/reply/roundContext.mjs
 * 【职责】轮次上下文刷新：regen 循环在下一轮 `StructCall` 前调用，把本轮期间新到达的条目追加进 prompt_struct 并保证时序。
 * 【原理】先把各 part 已累积的 `additional_chat_log` 收拢为一个 `type:'container'` 条目（自身不贡献 log，只展开 `logContextAfter`）
 *   追加到 `prompt_struct.chat_log` 末尾并清空各 additional；再调用 `args.Update()` 重读权威日志，按 id 去重后追加新条目。
 *   这样旧工具日志被封存在 base chat_log 内，新条目排在其后，避免 merge 顺序（base → additional）导致新条目插到旧日志之前。
 *   最后调用 `args.ClearPendingMessages?.()`：角色已能看到新内容，shell 无需在生成结束再补一次触发。
 * 【数据结构】WeakMap<args, Set<string>> 记录本代已注入 id（即使 summarize 替换了 chat_log 仍能正确去重）。
 * 【关联】prompt_struct/index.mjs 的 mergeStructPromptChatLog 展开 container；decl/chatLog.ts 的 CONTAINER_ENTRY_TYPE；各 char 模板 regen 循环调用。
 */
/** @typedef {import('../../../../../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t */

import { CONTAINER_ENTRY_TYPE } from '../chat/logEntryTypes.mjs'

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
 * 按 mergeStructPromptChatLog 的合并顺序列出各 part 的 additional_chat_log 数组（可变引用）。
 * @param {object} prompt_struct 提示结构
 * @returns {chatLogEntry_t[][]} 追加日志数组列表
 */
function collectSectionLogs(prompt_struct) {
	const buckets = []
	/**
	 * 收集一个 part 的追加日志。
	 * @param {object} [part] 单部分提示
	 * @returns {void}
	 */
	const push = part => {
		if (part?.additional_chat_log?.length) buckets.push(part.additional_chat_log)
	}
	push(prompt_struct.user_prompt)
	push(prompt_struct.world_prompt)
	for (const part of Object.values(prompt_struct.other_chars_prompts || {})) push(part)
	for (const part of Object.values(prompt_struct.other_personas_prompts || {})) push(part)
	for (const part of Object.values(prompt_struct.plugin_prompts || {})) push(part)
	push(prompt_struct.char_prompt)
	return buckets
}

/**
 * 把已累积的追加上下文封存进一个新 container 条目，并清空各 additional 数组。
 * @param {object} args 请求上下文
 * @param {object} prompt_struct 提示结构
 * @returns {void}
 */
function sealAdditionalChatLog(args, prompt_struct) {
	const buckets = collectSectionLogs(prompt_struct)
	if (!buckets.length) return
	const old = []
	for (const bucket of buckets) {
		old.push(...bucket)
		bucket.length = 0
	}
	prompt_struct.chat_log ??= []
	prompt_struct.chat_log.push({
		id: crypto.randomUUID(),
		type: CONTAINER_ENTRY_TYPE,
		role: 'system',
		name: 'system',
		uid: 'system',
		content: '',
		content_for_show: '',
		files: [],
		...args?.char_id ? { charVisibility: [args.char_id] } : {},
		logContextAfter: old,
	})
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
 * 轮次上下文刷新：封存旧追加上下文，并追加 `args.Update()` 返回的新条目。
 * @param {object} args 请求上下文（需含 `Update` 才可采集新条目）
 * @param {object} prompt_struct 提示结构
 * @returns {Promise<void>}
 */
export async function injectRoundEntries(args, prompt_struct) {
	if (!prompt_struct?.chat_log) return

	let seen = injectedIds.get(args)
	if (!seen) {
		seen = new Set()
		injectedIds.set(args, seen)
		rememberEntries(seen, prompt_struct.chat_log)
		for (const bucket of collectSectionLogs(prompt_struct)) rememberEntries(seen, bucket)
	}

	sealAdditionalChatLog(args, prompt_struct)

	try {
		if (typeof args?.Update !== 'function') return
		let fresh
		try {
			fresh = await args.Update()
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
	finally {
		// 本轮刷新（container 封存 / Update）后角色已能看到新内容：清除本槽位待触发标记，避免结束再补一次多余生成
		args.ClearPendingMessages?.()
	}
}
