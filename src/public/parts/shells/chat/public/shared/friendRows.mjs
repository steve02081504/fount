/**
 * 【文件】public/shared/friendRows.mjs
 * 【职责】好友（DM）会话行的纯构建逻辑：仅含带 `friendBinding` 的群。
 * 【原理】好友列表只展示私聊（DM）会话；普通（多人）群不带 friendBinding，归群侧栏（serverBar），不应混入好友列表。
 *   本模块无 DOM / store 依赖，可纯 Deno 单测。
 * 【关联】friendBinding、hub/friendsList、hub/friendBindings。
 */
import { normalizeFriendBinding } from './friendBinding.mjs'

/**
 * 好友侧栏行。
 * @typedef {object} FriendRow
 * @property {string} groupId 私聊群 ID
 * @property {string} key 对端 entityHash
 * @property {string} displayName 侧栏展示名
 * @property {string} [charname] 本地角色 part 名（用户 DM 时省略）
 * @property {import('./friendBinding.mjs').FriendBinding} binding 好友绑定
 * @property {object} session 侧栏会话摘要（最后消息等）
 */

/**
 * 由群摘要构建好友（DM）侧栏行。
 * 仅含带 friendBinding 的群；普通（多人）群被排除——它们由调用方按群侧栏展示。
 * 同一对端多个群时保留最后消息时间更新的那个。
 * @param {Array<{ groupId: string, name?: string, friendBinding?: unknown, lastMessageTime?: string | number }>} groups 群摘要
 * @returns {FriendRow[]} 好友行（最后消息时间倒序，同时间按展示名）
 */
export function buildFriendRows(groups) {
	/** @type {Map<string, FriendRow>} */
	const byEntityHash = new Map()
	for (const group of groups || []) {
		const binding = normalizeFriendBinding(group?.friendBinding)
		if (!binding) continue
		const row = {
			groupId: group.groupId,
			key: binding.entityHash,
			displayName: binding.displayName || binding.charname || group.name || group.groupId,
			charname: binding.charname,
			binding,
			session: {
				groupId: group.groupId,
				lastMessageContent: '',
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
	rows.sort((a, b) => {
		const ta = new Date(a.session.lastMessageTime || 0).getTime()
		const tb = new Date(b.session.lastMessageTime || 0).getTime()
		if (ta !== tb) return tb - ta
		return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
	})
	return rows
}
