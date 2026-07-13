import { socialPostKey } from '../federation/post_key.mjs'
import { listPollTally } from '../federation/poll_index.mjs'
import { isPollClosed, viewerPollChoicesFromView } from '../lib/poll.mjs'
import { maybeDecryptPostContent } from '../vault_crypto/vault.mjs'

/**
 * @param {{ likes: Map<string, number>, reposts: Map<string, number>, replies: Map<string, number> }} engagement 互动计数索引
 * @param {Set<string>} viewerLiked 观看者已赞键集合
 * @returns {(targetEntityHash: string, targetPostId: string) => object} 互动计数查询
 */
export function createEngagementForPost(engagement, viewerLiked) {
	return function engagementForPost(targetEntityHash, targetPostId) {
		const key = socialPostKey(targetEntityHash, targetPostId)
		return {
			likeCount: engagement.likes.get(key) || 0,
			repostCount: engagement.reposts.get(key) || 0,
			replyCount: engagement.replies.get(key) || 0,
			viewerLiked: viewerLiked.has(key),
		}
	}
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 作者
 * @param {object} post 物化帖子
 * @returns {Promise<object>} 解密后的帖子副本
 */
export async function withDecryptedPostContent(username, entityHash, post) {
	const decrypted = await maybeDecryptPostContent(username, entityHash, post.content)
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
	const postOut = decrypt
		? await withDecryptedPostContent(username, entityHash, post)
		: post
	const item = {
		kind: 'post',
		entityHash,
		postId: post.id,
		post: postOut,
		hlc: post.hlc,
		authorProfile: await feedContext.authorProfile(entityHash),
		...feedContext.engagementForPost(entityHash, post.id),
	}
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
	return item
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
		...feedContext.engagementForPost(head.originalEntityHash, head.originalPostId),
	}
}
