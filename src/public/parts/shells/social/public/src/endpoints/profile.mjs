/** Social 资料页：帖子/点赞/回复/关注列表、隐私设置、屏蔽词。 */
import { socialRequest } from './client.mjs'

/**
 * @param {string} entityHash 实体
 * @returns {Promise<{ profile: object, socialMeta: object, isFollowing: boolean, postCount: number, followingCount: number, followerCount: number }>} 资料
 */
export function getProfile(entityHash) {
	return socialRequest(`/profile/${encodeURIComponent(entityHash)}`)
}

/**
 * @param {string} entityHash owner
 * @param {{ limit?: number, cursor?: string }} [options] 分页
 * @returns {Promise<{ items: object[], nextCursor: string | null }>} 帖子页
 */
export function getProfilePosts(entityHash, { limit = 30, cursor } = {}) {
	const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
	return socialRequest(`/profile/${encodeURIComponent(entityHash)}/posts?limit=${limit}${cursorQuery}`)
}

/**
 * @param {string} entityHash owner
 * @returns {Promise<{ items: object[] }>} 点赞帖列表
 */
export function getProfileLikes(entityHash) {
	return socialRequest(`/profile/${encodeURIComponent(entityHash)}/likes`)
}

/**
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @returns {Promise<{ replies: object[] }>} 回复列表
 */
export function getProfileReplies(entityHash, postId) {
	return socialRequest(`/profile/${encodeURIComponent(entityHash)}/replies/${encodeURIComponent(postId)}`)
}

/**
 * @param {string} entityHash 实体
 * @returns {Promise<{ followers: object[] }>} 粉丝列表
 */
export function getProfileFollowers(entityHash) {
	return socialRequest(`/profile/${encodeURIComponent(entityHash)}/followers`)
}

/**
 * @param {string} entityHash 实体
 * @returns {Promise<{ following: object[] }>} 关注列表
 */
export function getProfileFollowing(entityHash) {
	return socialRequest(`/profile/${encodeURIComponent(entityHash)}/following`)
}

/**
 * @param {{ hideFromDiscovery?: boolean }} body meta 更新
 * @returns {Promise<object>} 更新后的 meta
 */
export function updateProfileMeta(body) {
	return socialRequest('/profile/meta', { method: 'POST', body: JSON.stringify(body) })
}

/**
 * @returns {Promise<{ entries: object[] }>} 屏蔽词条目
 */
export function getMutedKeywords() {
	return socialRequest('/profile/muted-keywords')
}

/**
 * @param {object[]} entries 屏蔽词条目
 * @returns {Promise<{ entries: object[] }>} 服务端保存后的条目
 */
export function putMutedKeywords(entries) {
	return socialRequest('/profile/muted-keywords', { method: 'PUT', body: JSON.stringify({ entries }) })
}
