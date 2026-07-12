import { memberEntityHash } from '../../chat/lib/entity.mjs'
import { getState } from '../../chat/dag/materialize.mjs'
import { resolveActiveMemberKeyForLocalUser } from '../access.mjs'

/**
 * @param {object} state 物化群状态
 * @returns {Map<string, number>} roleId → active 成员数
 */
function countRoleMembers(state) {
	/** @type {Map<string, number>} */
	const counts = new Map()
	for (const member of Object.values(state.members || {})) {
		if (member?.status !== 'active') continue
		for (const roleId of member.roles || [])
			counts.set(roleId, (counts.get(roleId) || 0) + 1)
	}
	return counts
}

/**
 * 群内 @ 提及 autocomplete 候选。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} [query=''] 过滤词
 * @param {number} [limit=20] 条数上限
 * @returns {Promise<{ suggestions: object[] }>} autocomplete 候选
 */
export async function suggestGroupMentions(username, groupId, query = '', limit = 20) {
	const normalizedQuery = query.trim().toLowerCase()
	const { state } = await getState(username, groupId)
	const viewerKey = await resolveActiveMemberKeyForLocalUser(username, groupId, state)
	const roleCounts = countRoleMembers(state)
	/** @type {object[]} */
	const suggestions = []
	const seen = new Set()

	const roleCandidates = [
		{ kind: 'everyone', roleId: 'everyone', displayName: '@everyone', memberCount: roleCounts.get('@everyone') || 0 },
		{ kind: 'here', roleId: 'here', displayName: '@here', memberCount: roleCounts.get('@everyone') || 0 },
	]
	for (const role of roleCandidates) {
		if (normalizedQuery && !role.displayName.toLowerCase().includes(normalizedQuery)) continue
		suggestions.push(role)
	}

	for (const [roleId, role] of Object.entries(state.roles || {})) {
		if (roleId === '@everyone') continue
		const displayName = `@${role?.name || roleId}`
		if (normalizedQuery
			&& !displayName.toLowerCase().includes(normalizedQuery)
			&& !roleId.toLowerCase().includes(normalizedQuery))
			continue
		suggestions.push({
			kind: 'role',
			roleId,
			displayName,
			memberCount: roleCounts.get(roleId) || 0,
		})
	}

	for (const [memberKey, member] of Object.entries(state.members || {})) {
		if (member?.status !== 'active') continue
		if (viewerKey && memberKey.toLowerCase() === viewerKey.toLowerCase()) continue
		const entityHash = memberEntityHash(member)
		if (!entityHash || seen.has(entityHash)) continue
		const displayName = String(member.displayName || member.charname || '').trim()
			|| `${memberKey.slice(0, 8)}…`
		if (normalizedQuery
			&& !displayName.toLowerCase().includes(normalizedQuery)
			&& !entityHash.includes(normalizedQuery)
			&& !String(member.charname || '').toLowerCase().includes(normalizedQuery))
			continue
		seen.add(entityHash)
		suggestions.push({
			entityHash,
			displayName,
			memberKey,
			kind: member.memberKind === 'agent' ? 'agent' : 'user',
			...member.charname ? { charname: member.charname } : {},
		})
	}

	suggestions.sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'))
	return { suggestions: suggestions.slice(0, Math.min(50, Math.max(1, limit))) }
}
