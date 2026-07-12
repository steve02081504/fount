import { createMember } from './member.mjs'

/**
 * @param {import('./internal.mjs').ChatApiContext} ctx API 上下文
 * @param {string} groupId 群 ID
 * @param {string} roleId 角色 ID
 * @param {object} roleRow 物化角色行
 * @returns {object} Role 鸭子类型
 */
export function createRole(ctx, groupId, roleId, roleRow) {
	return {
		id: roleId,
		name: roleRow?.name || roleId,
		permissions: roleRow?.permissions || {},
		position: roleRow?.position ?? 0,
		/**
		 * @returns {Promise<object[]>} 持有该角色的成员
		 */
		async members() {
			const { loadGroupState } = await import('./internal.mjs')
			const state = await loadGroupState(ctx, groupId)
			const out = []
			for (const [, member] of Object.entries(state.members || {})) {
				if (member?.status !== 'active') continue
				if (!(member.roles || []).includes(roleId)) continue
				const entityHash = (await import('../chat/lib/entity.mjs')).memberEntityHash(member)
				if (!entityHash) continue
				out.push(createMember(ctx, groupId, entityHash, member))
			}
			return out
		},
	}
}
