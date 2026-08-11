/**
 * 【文件】group/lib/friendBinding.mjs
 * 【职责】将请求体 friendBinding 物化为可持久化形态（本地 agent 补全 charname / entityHash）。
 * 【原理】创建输入互斥 `{ entityHash }` 或 `{ charname }`；补全后交给 normalizeFriendBinding 做 hex/展示名校验。
 * 【关联】entity/charPartName、entity/identity、entity/member、public/shared/friendBinding
 */
import { normalizeFriendBinding } from '../../../public/shared/friendBinding.mjs'
import { resolveCharPartName } from '../../entity/charPartName.mjs'
import { resolveCharPartNameForEntity } from '../../entity/identity.mjs'
import { ensureLocalAgentEntityHash } from '../../entity/member.mjs'

/**
 * 将请求中的 friendBinding 物化为可持久化形态。
 * 创建输入互斥：`{ entityHash }` 或 `{ charname }`（可选 displayName）；本地 agent 的 charname 由服务端补全。
 * @param {string} username replica
 * @param {unknown} raw 请求体 friendBinding
 * @returns {Promise<import('../../../public/shared/friendBinding.mjs').FriendBinding | null>} 规范化绑定
 */
export async function materializeFriendBinding(username, raw) {
	if (!raw) return null

	if (raw.charname) {
		const charname = resolveCharPartName(username, raw.charname)
		const entityHash = await ensureLocalAgentEntityHash(username, charname)
		return normalizeFriendBinding({
			entityHash,
			charname,
			displayName: raw.displayName,
		})
	}

	const binding = normalizeFriendBinding({
		entityHash: raw.entityHash,
		displayName: raw.displayName,
	})
	if (!binding) return null
	const charname = await resolveCharPartNameForEntity(username, binding.entityHash)
	return charname ? { ...binding, charname } : binding
}
