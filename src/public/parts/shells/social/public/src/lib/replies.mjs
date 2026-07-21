import { socialApi } from './apiClient.mjs'
import { primaryLocale } from '/scripts/i18n/index.mjs'

/**
 * 提交对指定帖子的公开回复。
 * @param {string} entityHash 目标作者
 * @param {string} postId 帖子
 * @param {string} text 回复正文
 * @returns {Promise<void>}
 */
export async function submitReply(entityHash, postId, text) {
	await socialApi('/posts', {
		method: 'POST',
		body: JSON.stringify({
			text,
			replyTo: { entityHash, postId },
			visibility: 'public',
			locale: document.getElementById('postLocale')?.value.trim() || primaryLocale(),
		}),
	})
}
