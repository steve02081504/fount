/**
 * 作者评论门控：replyPolicy + 精选评论资格判断。
 */
import { getTimelineMaterialized } from '../timeline/materialize.mjs'
import { maybeDecryptPostContent } from '../vault_crypto/vault.mjs'

/**
 *
 */
export const REPLY_POLICIES = new Set(['everyone', 'followers_7d', 'author_follows'])
/**
 *
 */
export const FOLLOWERS_7D_MS = 7 * 24 * 60 * 60 * 1000

/**
 * @param {unknown} raw 原始值
 * @returns {'everyone' | 'followers_7d' | 'author_follows'} 规范化
 */
export function normalizeReplyPolicy(raw) {
	const value = String(raw || '').trim()
	return REPLY_POLICIES.has(value) ? /** @type {'everyone' | 'followers_7d' | 'author_follows'} */ value : 'everyone'
}

/**
 * @param {unknown} raw 原始值
 * @returns {'all' | 'featured_only'} 规范化
 */
export function normalizeReplyDisplay(raw) {
	return String(raw || '').trim() === 'featured_only' ? 'featured_only' : 'all'
}

/**
 * 从 replier 时间线取对作者最近一次仍有效的 follow 时刻。
 * @param {object} replierView 物化视图
 * @param {string} authorEntityHash 作者
 * @returns {number | null} follow 时刻 wall ms
 */
export function latestFollowWallForAuthor(replierView, authorEntityHash) {
	const target = authorEntityHash.toLowerCase()
	if (!(replierView.following || []).map(id => id.toLowerCase()).includes(target))
		return null
	let latest = null
	for (const event of replierView.followEvents || []) {
		if (String(event.content?.targetEntityHash || '').toLowerCase() !== target) continue
		const wall = Number(event.hlc?.wall) || Number(event.timestamp) || 0
		if (!latest || wall > latest) latest = wall
	}
	return latest
}

/**
 * @param {object} options 参数
 * @param {string} options.username replica
 * @param {string} options.authorEntityHash 帖作者
 * @param {string} options.replierEntityHash 回复者
 * @param {string} options.replyPolicy 门控
 * @param {number} [options.at] 回复时刻
 * @returns {Promise<boolean>} 是否允许
 */
export async function canReplyUnderPolicy({ username, authorEntityHash, replierEntityHash, replyPolicy, at = Date.now() }) {
	const author = authorEntityHash.toLowerCase()
	const replier = replierEntityHash.toLowerCase()
	const policy = normalizeReplyPolicy(replyPolicy)
	if (replier === author) return true
	if (policy === 'everyone') return true

	if (policy === 'author_follows') {
		const authorView = await getTimelineMaterialized(username, author)
		return (authorView.following || []).map(id => id.toLowerCase()).includes(replier)
	}

	if (policy === 'followers_7d') {
		const replierView = await getTimelineMaterialized(username, replier)
		const followWall = latestFollowWallForAuthor(replierView, author)
		if (followWall == null) return false
		return Number(at) - followWall >= FOLLOWERS_7D_MS
	}

	return true
}

/**
 * 读取目标帖的 replyPolicy（含解密）。
 * @param {string} username replica
 * @param {string} authorEntityHash 作者
 * @param {string} postId 帖 id
 * @returns {Promise<{ post: object, content: object, replyPolicy: string, replyDisplay: string } | null>} 门控信息；帖不存在则为 null
 */
export async function loadPostReplyGate(username, authorEntityHash, postId) {
	const author = authorEntityHash.toLowerCase()
	const view = await getTimelineMaterialized(username, author)
	const post = view.postById?.[postId] || view.posts?.find(row => row.id === postId)
	if (!post) return null
	const content = await maybeDecryptPostContent(username, author, post.content) || post.content || {}
	return {
		post,
		content,
		replyPolicy: normalizeReplyPolicy(content.replyPolicy),
		replyDisplay: normalizeReplyDisplay(content.replyDisplay),
	}
}

/**
 * 精选回复键。
 * @param {string} replierEntityHash 回复作者
 * @param {string} replyPostId 回复帖 id
 * @returns {string} 键
 */
export function featuredReplyKey(replierEntityHash, replyPostId) {
	return `${String(replierEntityHash).toLowerCase()}:${String(replyPostId)}`
}
