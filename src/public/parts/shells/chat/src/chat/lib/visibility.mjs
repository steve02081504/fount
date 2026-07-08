/**
 * 【文件】lib/visibility.mjs
 * 【职责】频道消息 visibility ACL：按 visibility.roles / visibility.members 与查看者 memberId、roles 做 OR 语义判定。
 * 【原理】canViewMessage 无 visibility 则全员可见；roles 与 members 任一匹配即通过。
 * 【当前用途】仅 prompt_struct 组装路径（entryVisibleForPrompt）；读路径 viewer 化由 world/persona GetChatLogForViewer 负责。
 * 【数据结构】visibility { roles?: string[], members?: string[] }；viewer { memberId, roles, charId? }。
 * 【关联】prompt_struct/index.mjs。
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
