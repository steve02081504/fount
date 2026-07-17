/**
 * 【文件】viewerLog.mjs — world/persona chat_log 视图统一分发与 viewer 角色解析
 * 【职责】applyWorldChatLogView / applyPersonaChatLogView；resolveViewerRoles 从物化 members 取 roles。
 * 【原理】以 viewer 为键；顺序固定为 world（客观）→ persona（主观）。world/user 恒存在。
 * 【数据结构】chatViewer_t；state.members[memberKey].roles。
 * 【关联】chatRequest、materializeViewerLog、worldAPI、userAPI、group/access、prompt_struct visibility。
 */
/** @typedef {import('../../../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t */
/** @typedef {import('../../../../../../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t */
/** @typedef {import('../../../../../../../decl/chatLog.ts').chatViewer_t} chatViewer_t */

import {
	resolveActiveAgentMemberKeyByCharname,
	resolveActiveMemberKeyForLocalUser,
} from '../../group/access.mjs'

/**
 * 从物化群状态解析当前 viewer 的角色列表。
 * @param {object} state 物化群状态（含 members）
 * @param {{ charname?: string, replicaUsername: string, groupId: string, memberKey?: string }} options 角色名、本机用户上下文；可直接给 memberKey 跳过解析
 * @returns {Promise<string[]>} 活跃成员 roles；无成员记录时为 []
 */
export async function resolveViewerRoles(state, options) {
	const { charname, replicaUsername, groupId, memberKey: overrideKey } = options
	const memberKey = overrideKey
		?? (charname
			? resolveActiveAgentMemberKeyByCharname(state, charname)
			: await resolveActiveMemberKeyForLocalUser(replicaUsername, groupId, state))
	if (!memberKey) return []
	const roles = state.members?.[memberKey]?.roles
	return Array.isArray(roles) ? [...roles] : ['@everyone']
}

/**
 * 对 chat_log 应用 world 视图变换（GetChatLogForViewer）。
 * @param {chatReplyRequest_t} arg 已组装的回复请求（含 world / chat_log）
 * @param {chatViewer_t} viewer 观察者
 * @returns {Promise<chatLogEntry_t[]>} 视图化后的日志
 */
export async function applyWorldChatLogView(arg, viewer) {
	// undefined = 未实现（本地缺钩子或远端 METHOD_NOT_FOUND）→ 透传
	return await arg.world.interfaces.chat.GetChatLogForViewer?.(arg, viewer) ?? arg.chat_log
}

/**
 * 对 chat_log 应用 persona 主观滤镜（GetChatLogForViewer）。
 * @param {chatReplyRequest_t} arg 已组装的回复请求（含 user / chat_log；应已过 world 滤镜）
 * @param {chatViewer_t} viewer 观察者
 * @returns {Promise<chatLogEntry_t[]>} 视图化后的日志
 */
export async function applyPersonaChatLogView(arg, viewer) {
	return await arg.user.interfaces.chat.GetChatLogForViewer?.(arg, viewer) ?? arg.chat_log
}
