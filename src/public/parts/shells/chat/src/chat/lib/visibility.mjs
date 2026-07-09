/**
 * 【文件】lib/visibility.mjs
 * 【职责】频道消息 visibility ACL：按 visibility.roles / visibility.members 与查看者 memberId、roles 做 OR 语义判定；charVisibility 白名单限定目标 char。
 * 【原理】canViewMessage 无 visibility 则全员可见；roles 与 members 任一匹配即通过。entryVisibleToViewer 叠加 charVisibility（有列表时仅列表内 char 可见）。
 * 【当前用途】prompt_struct 组装（entryVisibleForPrompt）与 view-log 物化（materializeViewerChatLog base 层）——agent LLM 视图与 human view-log 同规则；world/persona GetChatLogForViewer 在其之上做各自的视图变换。raw /messages 不过滤（治理/审计口）。
 * 【数据结构】visibility { roles?: string[], members?: string[] }；charVisibility string[]；viewer { memberId, roles, charId? }。
 * 【关联】prompt_struct/index.mjs、session/materializeViewerLog.mjs。
 */

/**
 * 检查当前 member 是否有权看到某条消息（OR 语义）。
 * @param {{ roles?: string[], members?: string[] } | null | undefined} visibility 可见性约束
 * @param {{ memberId: string, roles: string[], charId?: string }} viewer 当前查看者
 * @returns {boolean} 是否可见
 */
export function canViewMessage(visibility, viewer) {
	if (!visibility) return true
	const { roles, members } = visibility
	const hasRoles = Array.isArray(roles) && roles.length > 0
	const hasMembers = Array.isArray(members) && members.length > 0
	if (!hasRoles && !hasMembers) return true
	if (hasMembers && (members.includes(viewer.memberId) || (viewer.charId && members.includes(viewer.charId))))
		return true
	if (hasRoles && roles.some(r => viewer.roles?.includes(r))) return true
	return false
}

/**
 * 条目级可见性判定：charVisibility 白名单（限定目标 char）+ visibility ACL。
 * @param {{ visibility?: object, charVisibility?: string[] }} entry 日志条目
 * @param {{ memberId: string, roles: string[], charId?: string }} viewer 当前查看者
 * @returns {boolean} 是否可见
 */
export function entryVisibleToViewer(entry, viewer) {
	if (entry.charVisibility?.length && !(viewer.charId && entry.charVisibility.includes(viewer.charId)))
		return false
	return canViewMessage(entry.visibility, viewer)
}
