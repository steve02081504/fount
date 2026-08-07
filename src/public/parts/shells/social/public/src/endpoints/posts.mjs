/** Social 帖子读写、点赞/点踩/转发/投票/社区注解、编辑历史、翻译。 */
import { socialRequest } from './client.mjs'

/**
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @returns {Promise<{ item: object }>} 帖子详情
 */
export function getPost(entityHash, postId) {
	return socialRequest(`/posts/${encodeURIComponent(entityHash)}/${encodeURIComponent(postId)}`)
}

/**
 * @param {object} body 发帖请求体
 * @returns {Promise<object>} 已发布帖子事件
 */
export function createPost(body) {
	return socialRequest('/posts', { method: 'POST', body: JSON.stringify(body) })
}

/**
 * @param {string} postId 帖 id
 * @param {string} [entityHash] 作者（省略则为 operator）
 * @returns {Promise<{ event: object }>} 删除事件
 */
export function deletePost(postId, entityHash) {
	return socialRequest('/posts', {
		method: 'DELETE',
		body: JSON.stringify({ postId, ...entityHash ? { entityHash } : {} }),
	})
}

/**
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {boolean} like 点赞 / 取消点赞
 * @returns {Promise<{ event: object }>} 写入事件
 */
export function likePost(entityHash, postId, like) {
	return socialRequest(`/posts/${encodeURIComponent(entityHash)}/${encodeURIComponent(postId)}/like`, {
		method: 'POST',
		body: JSON.stringify({ like }),
	})
}

/**
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {boolean} dislike 点踩 / 取消点踩
 * @returns {Promise<{ event: object }>} 写入事件
 */
export function dislikePost(entityHash, postId, dislike) {
	return socialRequest(`/posts/${encodeURIComponent(entityHash)}/${encodeURIComponent(postId)}/dislike`, {
		method: 'POST',
		body: JSON.stringify({ dislike }),
	})
}

/**
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {string} [comment] 转发评论
 * @returns {Promise<{ item?: object }>} 转发结果
 */
export function repostPost(entityHash, postId, comment) {
	return socialRequest(`/posts/${encodeURIComponent(entityHash)}/${encodeURIComponent(postId)}/repost`, {
		method: 'POST',
		body: JSON.stringify({ comment }),
	})
}

/**
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {number[]} choices 选项下标
 * @returns {Promise<{ event: object }>} 写入事件
 */
export function pollVote(entityHash, postId, choices) {
	return socialRequest(`/posts/${encodeURIComponent(entityHash)}/${encodeURIComponent(postId)}/poll-vote`, {
		method: 'POST',
		body: JSON.stringify({ choices }),
	})
}

/**
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {string} text 新正文
 * @returns {Promise<{ event: object }>} 写入事件
 */
export function editPost(entityHash, postId, text) {
	return socialRequest(`/posts/${encodeURIComponent(entityHash)}/${encodeURIComponent(postId)}/edit`, {
		method: 'POST',
		body: JSON.stringify({ text }),
	})
}

/**
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {string} text 注解正文
 * @returns {Promise<{ event: object }>} 写入事件
 */
export function addPostNote(entityHash, postId, text) {
	return socialRequest(`/posts/${encodeURIComponent(entityHash)}/${encodeURIComponent(postId)}/notes`, {
		method: 'POST',
		body: JSON.stringify({ text }),
	})
}

/**
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @returns {Promise<{ notes: object[] }>} 社区注解列表
 */
export function getPostNotes(entityHash, postId) {
	return socialRequest(`/posts/${encodeURIComponent(entityHash)}/${encodeURIComponent(postId)}/notes`)
}

/**
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {string} noteId 注解 id
 * @param {boolean} helpful 有帮助 / 无帮助
 * @returns {Promise<{ event: object }>} 写入事件
 */
export function votePostNote(entityHash, postId, noteId, helpful) {
	return socialRequest(
		`/posts/${encodeURIComponent(entityHash)}/${encodeURIComponent(postId)}/notes/${encodeURIComponent(noteId)}/vote`,
		{ method: 'POST', body: JSON.stringify({ helpful }) },
	)
}

/**
 * @param {string} text 原文
 * @param {string} targetLang 目标语言（BCP 47）
 * @returns {Promise<string>} 译文
 */
export async function translatePost(text, targetLang) {
	const data = await socialRequest('/translate', {
		method: 'POST',
		body: JSON.stringify({ text, targetLang }),
	})
	return String(data.translated ?? text)
}
