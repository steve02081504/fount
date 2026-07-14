/**
 * 【文件】group/access.mjs
 * 【职责】群成员身份解析与 RBAC 权限判定，供路由层与查询层复用。
 * 【原理】pubKeyHash / entityHash / charname 匹配活跃成员；本机用户从 per-entity local signer 推导 pubKeyHash。
 * 【数据结构】物化 state（members、roles、channels、channelPermissions）、PERMISSIONS 常量。
 * 【关联】被 group/routes/*、queries.mjs、localAuthz.mjs 引用；依赖 chat/dag/materialize、chat/lib/paths。
 */
import { hasPermission, PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'
import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

/**
 * @param {object} state 物化群状态
 * @param {string} identifier 成员键、pubKeyHash（64 hex）、entityHash（128 hex）或 agent charname
 * @returns {string | null} 成员在 state.members 中的键，无则 null
 */
export function resolveMemberKey(state, identifier) {
	const raw = String(identifier || '').trim().toLowerCase()
	if (!raw) return null
	if (state.members[raw]) return raw
	for (const [key, member] of Object.entries(state.members)) {
		if (member?.entityHash === raw) return key
		if (member?.memberKind === 'agent' && member.charname?.toLowerCase() === raw)
			return key
	}
	return null
}

/**
 * @param {object} state 物化群状态
 * @param {string} memberKey 成员 pubKeyHash
 * @returns {string | null} 活跃成员在 state.members 中的键，无则 null
 */
export function resolveActiveMemberKey(state, memberKey) {
	const key = resolveMemberKey(state, memberKey)
	return key && state.members[key]?.status === 'active' ? key : null
}

/**
 * @param {object} state 物化群状态
 * @param {string} charname 角色 part 名
 * @returns {string | null} 活跃 agent 成员键
 */
export function resolveActiveAgentMemberKeyByCharname(state, charname) {
	const name = String(charname || '').trim().toLowerCase()
	if (!name) return null
	for (const [key, member] of Object.entries(state.members))
		if (member?.memberKind === 'agent'
			&& member.status === 'active'
			&& member.charname?.toLowerCase() === name)
			return key

	return null
}

/**
 * 本机 replica：登录名对应 operator 实体的群成员键。
 * 只读推导（不物化、不创建种子）：本函数被 `getState` 的 leftPurge 检查调用，
 * 走 `resolveLocalEventSigner` 会回调 `getState` 形成无限递归。
 * @param {string} replicaUsername fount 登录名（仅用于 replica 磁盘路径）
 * @param {string} groupId 群 ID
 * @param {object} state 物化群状态
 * @returns {Promise<string | null>} 成员键
 */
export async function resolveActiveMemberKeyForLocalUser(replicaUsername, groupId, state) {
	const { peekLocalSignerPubKeyHash } = await import('../chat/dag/localSigner.mjs')
	const sender = await peekLocalSignerPubKeyHash(replicaUsername, groupId)
	return sender ? resolveActiveMemberKey(state, sender) : null
}

/**
 * 本机 replica 上任一活跃成员键：先 operator，再遍历本机已落盘 signer 的 entity。
 * 供水合 / AI runtime 等「有本机副本即可」路径；HTTP 身份路由仍用 `resolveActiveMemberKeyForLocalUser`。
 * @param {string} replicaUsername fount 登录名
 * @param {string} groupId 群 ID
 * @param {object} state 物化群状态
 * @returns {Promise<string | null>} 成员键
 */
export async function resolveActiveMemberKeyForLocalReplica(replicaUsername, groupId, state) {
	const operatorKey = await resolveActiveMemberKeyForLocalUser(replicaUsername, groupId, state)
	if (operatorKey) return operatorKey
	const { peekLocalSignerPubKeyHash } = await import('../chat/dag/localSigner.mjs')
	for (const [key, member] of Object.entries(state.members || {})) {
		if (member?.status !== 'active') continue
		const entityHash = String(member.entityHash || '').trim().toLowerCase()
		if (!entityHash) continue
		const sender = await peekLocalSignerPubKeyHash(replicaUsername, groupId, entityHash)
		if (sender && resolveActiveMemberKey(state, sender) === key) return key
	}
	return null
}

/**
 * @param {object} state 物化群状态
 * @param {object} member 成员记录
 * @param {string} permission 权限键
 * @param {string} channelId 频道 ID
 * @returns {boolean} 是否具备权限
 */
export function canInChannel(state, member, permission, channelId) {
	return hasPermission(member, permission, state.roles, channelId, state.channelPermissions)
}

/**
 * @param {object} state 物化群状态
 * @returns {string} 治理权限折叠用频道 id
 */
export function governanceChannelId(state) {
	const defaultChannelId = state.groupSettings?.defaultChannelId
	return state.channels[defaultChannelId] ? defaultChannelId : Object.keys(state.channels)[0] || 'default'
}

/**
 * @param {object} state 物化群状态
 * @param {object} member 成员记录
 * @returns {boolean} 是否可签发 reputation_slash（治理频道 ADMIN 或 MANAGE_ROLES）
 */
export function canGovSlash(state, member) {
	const channelId = governanceChannelId(state)
	return canInChannel(state, member, PERMISSIONS.ADMIN, channelId)
		|| canInChannel(state, member, PERMISSIONS.MANAGE_ROLES, channelId)
}

/**
 *
 */
export { isEntityHash128, PERMISSIONS }
