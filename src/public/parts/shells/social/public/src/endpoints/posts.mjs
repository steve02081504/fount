/** Social 帖子读写、点赞/点踩/转发/投票/社区注解、编辑历史、翻译。 */
import { socialRequest } from './client.mjs'

/**
 * 构造帖子子路径（已 encode）。
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {string} [suffix=''] 子路径后缀（如 `/like`）
 * @returns {string} `/posts/...` 路径
 */
function postPath(entityHash, postId, suffix = '') {
	return `/posts/${encodeURIComponent(entityHash)}/${encodeURIComponent(postId)}${suffix}`
}

/**
 * 读取单帖详情。
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @returns {Promise<{ item: object }>} 帖子详情
 */
export function getPost(entityHash, postId) {
	return socialRequest(postPath(entityHash, postId))
}

/**
 * 发帖。
 * @param {object} body 发帖请求体
 * @returns {Promise<object>} 已发布帖子事件
 */
export function createPost(body) {
	return socialRequest('/posts', { method: 'POST', body: JSON.stringify(body) })
}

/**
 * 删帖。
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
 * 点赞 / 取消点赞。
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {boolean} like 点赞 / 取消点赞
 * @returns {Promise<{ event: object }>} 写入事件
 */
export function likePost(entityHash, postId, like) {
	return socialRequest(postPath(entityHash, postId, '/like'), {
		method: 'POST',
		body: JSON.stringify({ like }),
	})
}

/**
 * 点踩 / 取消点踩。
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {boolean} dislike 点踩 / 取消点踩
 * @returns {Promise<{ event: object }>} 写入事件
 */
export function dislikePost(entityHash, postId, dislike) {
	return socialRequest(postPath(entityHash, postId, '/dislike'), {
		method: 'POST',
		body: JSON.stringify({ dislike }),
	})
}

/**
 * 转发帖子。
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {string} [comment] 转发评论
 * @returns {Promise<{ item?: object }>} 转发结果
 */
export function repostPost(entityHash, postId, comment) {
	return socialRequest(postPath(entityHash, postId, '/repost'), {
		method: 'POST',
		body: JSON.stringify({ comment }),
	})
}

/**
 * 投票。
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {number[]} choices 选项下标
 * @returns {Promise<{ event: object }>} 写入事件
 */
export function pollVote(entityHash, postId, choices) {
	return socialRequest(postPath(entityHash, postId, '/poll-vote'), {
		method: 'POST',
		body: JSON.stringify({ choices }),
	})
}

/**
 * 编辑帖子正文。
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {string} text 新正文
 * @returns {Promise<{ event: object }>} 写入事件
 */
export function editPost(entityHash, postId, text) {
	return socialRequest(postPath(entityHash, postId, '/edit'), {
		method: 'POST',
		body: JSON.stringify({ text }),
	})
}

/**
 * 添加社区注解。
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {string} text 注解正文
 * @returns {Promise<{ event: object }>} 写入事件
 */
export function addPostNote(entityHash, postId, text) {
	return socialRequest(postPath(entityHash, postId, '/notes'), {
		method: 'POST',
		body: JSON.stringify({ text }),
	})
}

/**
 * 列出社区注解。
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @returns {Promise<{ notes: object[] }>} 社区注解列表
 */
export function getPostNotes(entityHash, postId) {
	return socialRequest(postPath(entityHash, postId, '/notes'))
}

/**
 * 注解有帮助 / 无帮助投票。
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {string} noteId 注解 id
 * @param {boolean} helpful 有帮助 / 无帮助
 * @returns {Promise<{ event: object }>} 写入事件
 */
export function votePostNote(entityHash, postId, noteId, helpful) {
	return socialRequest(
		postPath(entityHash, postId, `/notes/${encodeURIComponent(noteId)}/vote`),
		{ method: 'POST', body: JSON.stringify({ helpful }) },
	)
}

/**
 * 翻译帖子正文。
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
