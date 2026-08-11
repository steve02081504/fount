/**
 * 【文件】group/lib/friendBinding.mjs
 * 【职责】将请求体 friendBinding 物化为可持久化形态（本地 agent 补全 charname / entityHash）。
 * 【原理】创建输入互斥 `{ entityHash }` 或 `{ charname }`；POST /groups 与 PUT meta 共用。
 * 【关联】entity/charPartName、entity/identity、entity/member、public/shared/friendBinding
 */

/**
 * 将请求中的 friendBinding 物化为可持久化形态。
 * 创建输入互斥：`{ entityHash }` 或 `{ charname }`（可选 displayName）；本地 agent 的 charname 由服务端补全。
 * @param {string} username replica
 * @param {unknown} raw 请求体 friendBinding
 * @returns {Promise<import('../../../public/shared/friendBinding.mjs').FriendBinding | null>} 规范化绑定
 */
export async function materializeFriendBinding(username, raw) {
	if (!raw) return null
	const { isEntityHash128 } = await import('npm:@steve02081504/fount-p2p/core/entity_id')
	const { normalizeFriendBinding } = await import('../../../public/shared/friendBinding.mjs')
	const displayName = raw.displayName != null && String(raw.displayName).trim()
		? String(raw.displayName).trim()
		: undefined
	if (raw.charname) {
		const { resolveCharPartName } = await import('../../entity/charPartName.mjs')
		const { ensureLocalAgentEntityHash } = await import('../../entity/member.mjs')
		const charname = resolveCharPartName(username, raw.charname)
		const ensured = await ensureLocalAgentEntityHash(username, charname)
		return normalizeFriendBinding({
			entityHash: ensured,
			charname,
			...displayName ? { displayName } : {},
		})
	}
	const entityHash = String(raw.entityHash ?? '').trim().toLowerCase()
	if (isEntityHash128(entityHash)) {
		const { resolveCharPartNameForEntity } = await import('../../entity/identity.mjs')
		const charname = await resolveCharPartNameForEntity(username, entityHash) || undefined
		return normalizeFriendBinding({
			entityHash,
			...charname ? { charname } : {},
			...displayName ? { displayName } : {},
		})
	}
	return null
}
