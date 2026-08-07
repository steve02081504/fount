/**
 * 【文件】public/src/endpoints/members.mjs
 * 【职责】成员管理 REST：踢出成员。封禁/解封见 groupBan.mjs / groupGovernance.mjs。
 * 【关联】groupSettings/membersTab.mjs、memberContextMenu.mjs。
 */
import { groupFetch, groupPath } from './groupClient.mjs'

/**
 * 踢出成员（不封禁，可重新加入）。
 * @param {string} groupId 群 ID
 * @param {string} pubKeyHash 成员公钥哈希
 * @returns {Promise<void>}
 */
export async function kickMember(groupId, pubKeyHash) {
	await groupFetch(groupPath(groupId, 'members', pubKeyHash, 'kick'), { method: 'POST' })
}
