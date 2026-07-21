import { summarizeNotes } from '../federation/note/index.mjs'
import { listPollTally } from '../federation/poll/index.mjs'
import { socialPostKey } from '../federation/post_key.mjs'
import { isPollClosed, viewerPollChoicesFromView } from '../lib/poll.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'
import { maybeDecryptPostContent } from '../vault_crypto/vault.mjs'

/**
 * @param {{ likes: Map<string, number>, dislikes?: Map<string, number>, reposts: Map<string, number>, replies: Map<string, number> }} engagement 互动计数索引
 * @param {Set<string>} viewerLiked 观看者已赞键集合
 * @param {Set<string>} [viewerDisliked] 观看者已踩键集合
 * @returns {(targetEntityHash: string, targetPostId: string) => object} 互动计数查询
 */
export function createEngagementForPost(engagement, viewerLiked, viewerDisliked = new Set()) {
	return function engagementForPost(targetEntityHash, targetPostId) {
		const key = socialPostKey(targetEntityHash, targetPostId)
		return {
			likeCount: engagement.likes.get(key) || 0,
			dislikeCount: engagement.dislikes?.get(key) || 0,
			repostCount: engagement.reposts.get(key) || 0,
			replyCount: engagement.replies.get(key) || 0,
			viewerLiked: viewerLiked.has(key),
			viewerDisliked: viewerDisliked.has(key),
		}
	}
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 作者
 * @param {object} post 物化帖子
 * @param {string | null} [viewerEntityHash] 读者实体哈希，定向帖解密用
 * @returns {Promise<object>} 解密后的帖子副本
 */
export async function withDecryptedPostContent(username, entityHash, post, viewerEntityHash = null) {
	const decrypted = await maybeDecryptPostContent(username, entityHash, post.content, viewerEntityHash)
	if (decrypted)
		return { ...post, content: decrypted }
	return { ...post, content: null, decryptView: { failed: true } }
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 作者
 * @param {object} post 物化帖子
 * @param {object} feedContext 构建上下文
 * @param {(entityHash: string) => Promise<object | null>} feedContext.authorProfile 作者资料加载器
 * @param {(targetEntityHash: string, targetPostId: string) => object} feedContext.engagementForPost 互动查询
 * @param {boolean} [feedContext.decrypt=true] 是否解密 content
 * @returns {Promise<object>} feed 条目
 */
export async function buildPostFeedItem(username, entityHash, post, feedContext) {
	const decrypt = feedContext.decrypt !== false
	const viewerEntityHash = feedContext.viewerEntityHash || null
	const postOut = decrypt
		? await withDecryptedPostContent(username, entityHash, post, viewerEntityHash)
		: post
	const authorProfile = await feedContext.authorProfile(entityHash)
	const item = {
		kind: 'post',
		entityHash,
		postId: post.id,
		post: postOut,
		hlc: post.hlc,
		authorProfile,
		ownerEntityHash: authorProfile?.ownerEntityHash || null,
		...feedContext.engagementForPost(entityHash, post.id),
	}
	const replyTo = postOut?.content?.replyTo || post.content?.replyTo
	if (replyTo?.entityHash && replyTo?.postId)
		item.replyContext = await buildReplyContext(username, replyTo, feedContext)
	if (feedContext.warmAlbumView)
		await feedContext.warmAlbumView(entityHash)
	if (feedContext.albumsForPost)
		item.albums = feedContext.albumsForPost(entityHash, post.id) || []
	const poll = postOut.content?.poll
	if (poll?.options?.length) {
		const tally = await listPollTally(username, entityHash, post.id)
		item.poll = {
			options: poll.options,
			multi: poll.multi === true,
			deadline: poll.deadline || null,
			tally,
			closed: isPollClosed(poll),
			viewerChoices: feedContext.viewerPollChoices
				? viewerPollChoicesFromView(feedContext.viewerPollChoices, entityHash, post.id)
				: null,
		}
	}
	const { topNote, notes } = await summarizeNotes(username, entityHash, post.id)
	if (topNote || notes.length)
		item.communityNote = { topNote, noteCount: notes.length }
	return item
}

/**
 * @param {string} username 用户
 * @param {{ entityHash: string, postId: string }} replyTo 被回复引用
 * @param {object} feedContext feed 构建上下文
 * @returns {Promise<object>} replyContext
 */
async function buildReplyContext(username, replyTo, feedContext) {
	const targetEntityHash = String(replyTo.entityHash).toLowerCase()
	const targetPostId = String(replyTo.postId)
	const authorProfile = await feedContext.authorProfile(targetEntityHash)
	let text = ''
	try {
		const view = await getTimelineMaterialized(username, targetEntityHash)
		const parent = view.postById?.[targetPostId] || view.posts?.find(row => row.id === targetPostId)
		if (parent?.content) {
			const decrypted = await maybeDecryptPostContent(
				username,
				targetEntityHash,
				parent.content,
				feedContext.viewerEntityHash || null,
			)
			text = String((decrypted || parent.content)?.text || '').slice(0, 200)
		}
	}
	catch { /* 父帖不可见时仅返回引用 */ }
	return {
		entityHash: targetEntityHash,
		postId: targetPostId,
		authorProfile,
		text,
	}
}

/**
 * @param {object} head repost 候选头
 * @param {object} originalPost 原帖
 * @param {object} feedContext 构建上下文
 * @returns {Promise<object>} feed 条目
 */
export async function buildRepostFeedItem(head, originalPost, feedContext) {
	return {
		kind: 'repost',
		entityHash: head.entityHash,
		postId: head.postId,
		post: originalPost,
		targetEntityHash: head.originalEntityHash,
		targetPostId: head.originalPostId,
		repostComment: String(head.repost.content?.comment || ''),
		hlc: head.hlc,
		authorProfile: await feedContext.authorProfile(head.entityHash),
		targetAuthorProfile: await feedContext.authorProfile(head.originalEntityHash),
		...feedContext.engagementForPost(head.originalEntityHash, head.originalPostId),
	}
}
