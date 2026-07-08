/**
 * 【文件】viewerLog.mjs — world/persona chat_log 视图统一分发与 viewer 角色解析
 * 【职责】applyWorldChatLogView / applyPersonaChatLogView；resolveViewerRoles 从物化 members 取 roles；buildViewer 构造 chatViewer_t。
 * 【原理】正式接口以 viewer 为键；老 world 仅实现 GetChatLogForCharname 时 char viewer 回退；顺序固定为 world（客观）→ persona（主观）。D6 后 world/user 恒存在。
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
 * @param {{ charname?: string, replicaUsername: string, groupId: string, memberKey?: string }} opts 角色名、本机用户上下文；可直接给 memberKey 跳过解析
 * @returns {Promise<string[]>} 活跃成员 roles；无成员记录时为 []
 */
export async function resolveViewerRoles(state, opts) {
	const { charname, replicaUsername, groupId, memberKey: overrideKey } = opts
	const memberKey = overrideKey
		?? (charname
			? resolveActiveAgentMemberKeyByCharname(state, charname)
			: await resolveActiveMemberKeyForLocalUser(replicaUsername, groupId, state))
	if (!memberKey) return []
	const roles = state.members?.[memberKey]?.roles
	return Array.isArray(roles) ? [...roles] : ['@everyone']
}

/**
 * 构造统一观察者对象。
 * @param {Partial<chatViewer_t> & Pick<chatViewer_t, 'kind' | 'memberId' | 'ownerUsername' | 'channelId'>} fields viewer 字段
 * @returns {chatViewer_t} chatViewer_t
 */
export function buildViewer(fields) {
	return {
		kind: fields.kind,
		memberId: fields.memberId,
		ownerUsername: fields.ownerUsername,
		channelId: fields.channelId,
		...fields.charname ? { charname: fields.charname } : {},
		...fields.roles ? { roles: fields.roles } : {},
		...fields.entityHash ? { entityHash: fields.entityHash } : {},
	}
}

/**
 * 对 chat_log 应用 world 视图变换（正式 GetChatLogForViewer，legacy charname 回退）。
 * @param {chatReplyRequest_t} arg 已组装的回复请求（含 world / chat_log）
 * @param {chatViewer_t} viewer 观察者
 * @returns {Promise<chatLogEntry_t[]>} 视图化后的日志
 */
export async function applyWorldChatLogView(arg, viewer) {
	const worldChat = arg.world.interfaces.chat

	if (worldChat.GetChatLogForViewer)
		return await worldChat.GetChatLogForViewer(arg, viewer)

	if (viewer.kind === 'char' && viewer.charname && worldChat.GetChatLogForCharname)
		return await worldChat.GetChatLogForCharname(arg, viewer.charname)

	return arg.chat_log
}

/**
 * 对 chat_log 应用 persona 主观滤镜（GetChatLogForViewer）。
 * @param {chatReplyRequest_t} arg 已组装的回复请求（含 user / chat_log；应已过 world 滤镜）
 * @param {chatViewer_t} viewer 观察者
 * @returns {Promise<chatLogEntry_t[]>} 视图化后的日志
 */
export async function applyPersonaChatLogView(arg, viewer) {
	const fn = arg.user.interfaces.chat.GetChatLogForViewer
	if (!fn) return arg.chat_log
	return await fn(arg, viewer)
}
