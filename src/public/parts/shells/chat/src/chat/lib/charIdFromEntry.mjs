/**
 * 【文件】lib/charIdFromEntry.mjs — chatLog 条目 → DAG charId
 * 【职责】从条目取出 chars/ 目录名；展示 name 不是 charId。
 * 【原理】仅读 `extension.timeSlice.charname`；world greeting（无角色）返回 null。
 * 【关联】dag/chatLogMirror.resolveMirrorContext。
 */

/**
 * @param {{ role?: string, name?: string, extension?: { timeSlice?: { charname?: string } } } | null | undefined} entry chatLog 条目
 * @returns {string | null} chars/ 目录名；无角色上下文时为 null
 */
export function charIdFromChatLogEntry(entry) {
	if (entry?.role !== 'char') return null
	return entry.extension?.timeSlice?.charname || null
}
