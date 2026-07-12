import { appendActorEvent } from '../chat/dag/append.mjs'

import { resolveActiveMemberKeyByEntityHash, resolveMemberKeyByEntityHash } from './internal.mjs'

/**
 * @param {import('./internal.mjs').ChatApiContext} ctx API 上下文
 * @param {string} groupId 群 ID
 * @param {string} entityHash 成员 entityHash
 * @param {object} memberRow 物化成员行
 * @returns {object} Member 鸭子类型
 */
export function createMember(ctx, groupId, entityHash, memberRow) {
	return {
		entityHash: String(entityHash).toLowerCase(),
		memberKind: memberRow?.memberKind || 'user',
		displayName: memberRow?.displayName || memberRow?.charname || entityHash.slice(64, 72),
		roles: [...memberRow?.roles || []],
		joinedAt: memberRow?.joinedAt ?? null,
		/**
		 * @returns {Promise<object>} 踢出成员
		 */
		async kick() {
			const { loadGroupState } = await import('./internal.mjs')
			const { dispatchBridgeMemberKick } = await import('./bridgeDispatch.mjs')
			const state = await loadGroupState(ctx, groupId)
			const targetKey = resolveActiveMemberKeyByEntityHash(state, entityHash)
			if (!targetKey) throw new Error('member not found')
			await dispatchBridgeMemberKick(ctx, groupId, state, targetKey, memberRow)
			return appendActorEvent(ctx.username, groupId, ctx.actor, {
				type: 'member_kick',
				timestamp: Date.now(),
				content: { targetMemberKey: targetKey },
			})
		},
		/**
		 * @returns {Promise<object>} 封禁成员
		 */
		async ban() {
			const { loadGroupState } = await import('./internal.mjs')
			const state = await loadGroupState(ctx, groupId)
			const targetKey = resolveMemberKeyByEntityHash(state, entityHash)
			if (!targetKey) throw new Error('member not found')
			return appendActorEvent(ctx.username, groupId, ctx.actor, {
				type: 'member_ban',
				timestamp: Date.now(),
				content: { targetMemberKey: targetKey },
			})
		},
		/**
		 * @returns {Promise<object>} 解封成员
		 */
		async unban() {
			const { loadGroupState } = await import('./internal.mjs')
			const state = await loadGroupState(ctx, groupId)
			const targetKey = resolveMemberKeyByEntityHash(state, entityHash)
			if (!targetKey) throw new Error('member not found')
			return appendActorEvent(ctx.username, groupId, ctx.actor, {
				type: 'member_unban',
				timestamp: Date.now(),
				content: { targetMemberKey: targetKey },
			})
		},
		/**
		 * @param {string} roleId 角色 ID
		 * @returns {Promise<object>} role_assign 事件
		 */
		async addRole(roleId) {
			const { loadGroupState } = await import('./internal.mjs')
			const state = await loadGroupState(ctx, groupId)
			const targetKey = resolveActiveMemberKeyByEntityHash(state, entityHash)
			if (!targetKey) throw new Error('member not found')
			return appendActorEvent(ctx.username, groupId, ctx.actor, {
				type: 'role_assign',
				timestamp: Date.now(),
				content: { targetMemberKey: targetKey, roleId },
			})
		},
		/**
		 * @param {string} roleId 角色 ID
		 * @returns {Promise<object>} role_revoke 事件
		 */
		async removeRole(roleId) {
			const { loadGroupState } = await import('./internal.mjs')
			const state = await loadGroupState(ctx, groupId)
			const targetKey = resolveActiveMemberKeyByEntityHash(state, entityHash)
			if (!targetKey) throw new Error('member not found')
			return appendActorEvent(ctx.username, groupId, ctx.actor, {
				type: 'role_revoke',
				timestamp: Date.now(),
				content: { targetMemberKey: targetKey, roleId },
			})
		},
		/**
		 * @returns {Promise<object>} DM 群
		 */
		async dm() {
			const { getChatClient } = await import('./index.mjs')
			const client = await getChatClient(ctx.username, ctx.actor.entityHash)
			return client.openDm(entityHash)
		},
	}
}
