/**
 * 【文件】public/hub/friendBindings.mjs
 * 【职责】好友绑定群在侧栏的归类：从群元数据解析 `FriendBinding`，过滤好友 DM 与角色私聊群。
 * 【原理】`getSidebarGroups` 决定服务器栏展示顺序；`isActiveFriendChat` 影响主栏布局分支；好友群仍走频道消息管道。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】`hashNav` 通过 `friendBindingForGroup` 将 hash 中的 groupId 导向 `enterFriendChat`；core/state。
 */
import { hubStore } from './core/state.mjs'

/**
 * @typedef {import('../src/friendBinding.mjs').FriendBinding} FriendBinding
 */

/**
 * @param {{ friendBinding?: FriendBinding | null } | null | undefined} group 群摘要行
 * @returns {FriendBinding | null} 规范化绑定；无 `entityHash` 时为 null
 */
export function resolveFriendBinding(group) {
	const raw = group?.friendBinding
	if (!raw?.entityHash) return null
	return {
		entityHash: String(raw.entityHash).trim().toLowerCase(),
		...raw.displayName ? { displayName: raw.displayName } : {},
		...raw.charname ? { charname: String(raw.charname).trim() } : {},
	}
}

/**
 * @param {{ friendBinding?: FriendBinding | null } | null | undefined} group 群摘要行
 * @returns {boolean} 是否应显示在好友列表并从群栏隐藏
 */
export function isFriendBoundGroup(group) {
	return !!resolveFriendBinding(group)
}

/**
 * @returns {typeof hubStore.sidebar.groups} 未绑定好友的群列表
 */
export function getSidebarGroups() {
	return hubStore.sidebar.groups.filter(g => !isFriendBoundGroup(g))
}

/**
 * @param {string} groupId 群 ID
 * @returns {FriendBinding | null} 该群的 `friendBinding`，未找到群时为 null
 */
export function friendBindingForGroup(groupId) {
	return resolveFriendBinding(hubStore.sidebar.groups.find(g => g.groupId === groupId))
}

/** @returns {boolean} 是否正在好友私聊会话中 */
export function isActiveFriendChat() {
	return !!hubStore.privateGroup.groupId
}
