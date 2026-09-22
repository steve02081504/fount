/**
 * 【文件】summaryBoundary.mjs — 摘要边界纯函数
 * 【职责】在合并后的聊天记录中，以最新的可见 summary 条目为界裁剪更早的历史，供 mergeStructPromptChatLog 使用。
 * 【原理】原始条目全部保留；仅从最新往旧扫描第一个可见的 summary 条目，返回其起（含）的切片。
 * 【关联】decl/chatLog.ts 提供 isSummaryEntry；session/summarize.mjs 生成 summary 条目；prompt_struct/index.mjs 调用。
 */
/** @typedef {import('../../../../../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t */

import { isSummaryEntry } from '../../../../../../decl/chatLog.ts'

/**
 * 以最新的可见摘要条目为界裁剪历史。
 * 从最新往旧扫描，取第一个可见摘要条目的索引 i，返回 `entries.slice(i)`（最新摘要胜出）；
 * 没有可见摘要时原样返回。
 * @param {chatLogEntry_t[]} entries 合并后的聊天记录
 * @param {(entry: chatLogEntry_t) => boolean} isVisible 可见性判定
 * @returns {chatLogEntry_t[]} 边界之后的条目
 */
export function applySummaryBoundary(entries, isVisible) {
	for (let i = entries.length - 1; i >= 0; i--)
		if (isSummaryEntry(entries[i]) && isVisible(entries[i]))
			return entries.slice(i)
	return entries
}
