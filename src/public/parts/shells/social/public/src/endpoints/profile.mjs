/** Social 资料页：帖子/点赞/回复/关注列表、隐私设置、屏蔽词。 */
import { socialRequest } from './client.mjs'

/**
 * 读取实体资料与社交 meta。
 * @param {string} entityHash 实体
 * @returns {Promise<{ profile: object, socialMeta: object, isFollowing: boolean, postCount: number, followingCount: number, followerCount: number }>} 资料
 */
export function getProfile(entityHash) {
	return socialRequest(`/profile/${encodeURIComponent(entityHash)}`)
}

/**
 * 资料页帖子流分页。
 * @param {string} entityHash owner
 * @param {{ limit?: number, cursor?: string }} [options] 分页
 * @returns {Promise<{ items: object[], nextCursor: string | null }>} 帖子页
 */
export function getProfilePosts(entityHash, { limit = 30, cursor } = {}) {
	const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
	return socialRequest(`/profile/${encodeURIComponent(entityHash)}/posts?limit=${limit}${cursorQuery}`)
}

/**
 * 资料页点赞列表。
 * @param {string} entityHash owner
 * @returns {Promise<{ items: object[] }>} 点赞帖列表
 */
export function getProfileLikes(entityHash) {
	return socialRequest(`/profile/${encodeURIComponent(entityHash)}/likes`)
}

/**
 * 单帖回复列表。
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @returns {Promise<{ replies: object[] }>} 回复列表
 */
export function getProfileReplies(entityHash, postId) {
	return socialRequest(`/profile/${encodeURIComponent(entityHash)}/replies/${encodeURIComponent(postId)}`)
}

/**
 * 粉丝列表。
 * @param {string} entityHash 实体
 * @returns {Promise<{ followers: object[] }>} 粉丝列表
 */
export function getProfileFollowers(entityHash) {
	return socialRequest(`/profile/${encodeURIComponent(entityHash)}/followers`)
}

/**
 * 关注列表。
 * @param {string} entityHash 实体
 * @returns {Promise<{ following: object[] }>} 关注列表
 */
export function getProfileFollowing(entityHash) {
	return socialRequest(`/profile/${encodeURIComponent(entityHash)}/following`)
}

/**
 * 更新本机资料隐私 meta。
 * @param {{ hideFromDiscovery?: boolean }} body meta 更新
 * @returns {Promise<object>} 更新后的 meta
 */
export function updateProfileMeta(body) {
	return socialRequest('/profile/meta', { method: 'POST', body: JSON.stringify(body) })
}

/**
 * 读取屏蔽词条目。
 * @returns {Promise<{ entries: object[] }>} 屏蔽词条目
 */
export function getMutedKeywords() {
	return socialRequest('/profile/muted-keywords')
}

/**
 * 写入屏蔽词条目。
 * @param {object[]} entries 屏蔽词条目
 * @returns {Promise<{ entries: object[] }>} 服务端保存后的条目
 */
export function putMutedKeywords(entries) {
	return socialRequest('/profile/muted-keywords', { method: 'PUT', body: JSON.stringify({ entries }) })
}
