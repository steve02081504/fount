import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { mentionsEntity } from 'fount/public/parts/shells/chat/public/shared/mentions.mjs'

import { memberEntityHash } from '../../entity/member.mjs'
import { getState } from '../dag/materialize.mjs'


/**
 * @param {object} state 物化群状态
 * @param {string} entityHash 待查实体
 * @returns {boolean} 是否群内 active 成员
 */
function isActiveGroupMember(state, entityHash) {
	const hash = entityHash || ''
	for (const member of Object.values(state.members || {})) {
		if (member?.status !== 'active') continue
		if (memberEntityHash(member) === hash) return true
	}
	return false
}

/**
 * @param {object} state 物化群状态
 * @param {string} entityHash 待查实体
 * @param {string[]} roleIds 角色 ID 列表
 * @returns {boolean} 成员是否持有任一角色
 */
function memberHasAnyRole(state, entityHash, roleIds) {
	const hash = entityHash || ''
	for (const member of Object.values(state.members || {})) {
		if (member?.status !== 'active') continue
		if (memberEntityHash(member) !== hash) continue
		const roles = member.roles || []
		return roleIds.some(roleId => roles.includes(roleId))
	}
	return false
}

/**
 * 判定实体是否被消息 mentions 结构命中（直接 @；叠加 role / everyone）。
 * @param {object} event OnMessage 事件或含 mentions 的上下文
 * @param {string} entityHash 待查实体
 * @returns {Promise<boolean>} 是否命中
 */
export async function messageMentionsEntity(event, entityHash) {
	const hash = entityHash || ''
	if (!isEntityHash128(hash)) return false
	const mentions = event?.mentions
	if (!mentions) return false
	if (mentionsEntity(mentions, hash)) return true
	const groupId = event?.group?.groupId
	const username = event?.chatReplyRequest?.username
	if (!groupId || !username) return false
	const { isVirtualBridgeGroupId } = await import('../bridge/session.mjs')
	if (isVirtualBridgeGroupId(groupId))
		// 虚拟桥接群无 DAG members：role/@everyone 无法展开，仅直接 entity @ 生效
		return false

	const { state } = await getState(username, groupId)
	if (mentions.everyone && isActiveGroupMember(state, hash)) return true
	if (mentions.roleIds?.length && memberHasAnyRole(state, hash, mentions.roleIds)) return true
	return false
}
