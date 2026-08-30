/**
 * 【文件】public/shared/friendRows.mjs
 * 【职责】好友（DM）会话行的纯构建逻辑：仅含带 `friendBinding` 的群。
 * 【原理】好友列表只展示私聊（DM）会话；普通（多人）群不带 friendBinding，归群侧栏（serverBar），不应混入好友列表。
 *   本模块无 DOM / store 依赖，可纯 Deno 单测。
 * 【关联】friendBinding、hub/friendsList、hub/friendBindings。
 */
import { isEntityHash128 } from './entityHash.mjs'
import { normalizeFriendBinding } from './friendBinding.mjs'
import { displayProfileAvatar, listAvatarTemplateFields } from './hashAvatar.mjs'

/**
 * 好友侧栏行。
 * @typedef {object} FriendRow
 * @property {string} groupId 私聊群 ID
 * @property {string} key 对端 entityHash
 * @property {string} displayName 侧栏展示名
 * @property {string} [charname] 本地角色 part 名（用户 DM 时省略）
 * @property {import('./friendBinding.mjs').FriendBinding} binding 好友绑定
 * @property {{ groupId: string, lastMessageContent?: string, lastMessageTime?: string | number }} session 侧栏会话摘要（最后消息等）
 */

/**
 * 由群摘要构建好友（DM）侧栏行。
 * 仅含带 friendBinding 的群；普通（多人）群被排除——它们由调用方按群侧栏展示。
 * 同一对端多个群时保留最后消息时间更新的那个。
 * @param {Array<{ groupId: string, name?: string, friendBinding: unknown, lastMessageTime?: string | number, lastMessageContent?: string }>} groups 群摘要
 * @returns {FriendRow[]} 好友行（最后消息时间倒序，同时间按展示名）
 */
export function buildFriendRows(groups) {
	/** @type {Map<string, FriendRow>} */
	const byEntityHash = new Map()
	for (const group of groups) {
		const binding = normalizeFriendBinding(group.friendBinding)
		if (!binding) continue
		const row = {
			groupId: group.groupId,
			key: binding.entityHash,
			displayName: binding.displayName || binding.charname || group.name || group.groupId,
			charname: binding.charname,
			binding,
			session: {
				groupId: group.groupId,
				lastMessageContent: group.lastMessageContent,
				lastMessageTime: group.lastMessageTime,
			},
		}
		const prev = byEntityHash.get(binding.entityHash)
		if (!prev) {
			byEntityHash.set(binding.entityHash, row)
			continue
		}
		const prevTime = new Date(prev.session.lastMessageTime || 0).getTime()
		const nextTime = new Date(row.session.lastMessageTime || 0).getTime()
		if (nextTime >= prevTime)
			byEntityHash.set(binding.entityHash, row)
	}
	const rows = [...byEntityHash.values()]
	rows.sort((leftRow, rightRow) => {
		const leftTimestamp = new Date(leftRow.session.lastMessageTime || 0).getTime()
		const rightTimestamp = new Date(rightRow.session.lastMessageTime || 0).getTime()
		if (leftTimestamp !== rightTimestamp) return rightTimestamp - leftTimestamp
		return leftRow.displayName.localeCompare(rightRow.displayName, undefined, { sensitivity: 'base' })
	})
	return rows
}

/**
 * 好友行头像模板字段（friendsList 渲染 / 纯函数可测）。
 * 有 profile 头像则渲染 `<img>`；否则回退 hash 字母占位。
 * `avatarFor` 始终携带对端 entityHash，供 `applyAvatarsTo` 异步 hydration：
 * DM 好友资料未缓存时先字母、profile 到位后补图（成员列表/消息区同款机制）。
 * @param {FriendRow} friend 好友行
 * @param {{ avatar?: string } | null | undefined} profile 对端资料（可能为 null）
 * @param {string} displayName 展示名（字母占位首字母）
 * @returns {{ avatarFor: string, avatarBg: string, avatarTextColor: string, avatarInner: string }} 模板字段
 */
export function friendAvatarTemplateFields(friend, profile, displayName) {
	const seed = friend.key || friend.groupId
	return {
		avatarFor: isEntityHash128(friend.key) ? friend.key : '',
		...listAvatarTemplateFields(seed, displayName, displayProfileAvatar(profile)),
	}
}
