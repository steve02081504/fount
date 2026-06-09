import { memoizePromise } from '../../../../../../scripts/memo.mjs'
import { ensureLocalEntityProfile, getProfile } from '../../../../../../scripts/p2p/entity/profile.mjs'
import { isEntityHash128 } from '../../../../../../scripts/p2p/entity_id.mjs'

/**
 * 单次 feed/search 构建内的作者资料摘要加载（请求级 memo，不跨请求共享）。
 * @param {string} username 查看者
 * @returns {(entityHash: string) => Promise<object | null>} 按 entityHash 去重加载的资料摘要
 */
export function createAuthorProfileLoader(username) {
	return memoizePromise(
		entityHash => entityHash,
		async entityHash => {
			if (!isEntityHash128(entityHash)) return null
			await ensureLocalEntityProfile(username, entityHash)
			const profile = await getProfile(entityHash, username)
			if (!profile) return null
			return { name: profile.name, avatar: profile.avatar || null }
		},
		{ max: 256 },
	)
}
