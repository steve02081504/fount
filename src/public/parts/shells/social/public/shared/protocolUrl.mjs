/**
 * 跨壳 protocol URL：定义在 chat，Social 仅 re-export（浏览器模块；勿被 Deno 纯测 import）。
 */
import { wrapProtocolHttpsUrl } from '/parts/shells:chat/shared/runUri.mjs'

import { formatSocialPostRunUri, formatSocialProfileRunUri } from './runUri.mjs'

/**
 *
 */
export { wrapProtocolHttpsUrl }

/**
 * @param {string} entityHash 作者 entityHash
 * @param {string} [postId] 帖子 id
 * @returns {string} 外部分享用 https 链接
 */
export function formatSocialShareHttpsUrl(entityHash, postId) {
	if (postId)
		return wrapProtocolHttpsUrl(formatSocialPostRunUri(entityHash, postId))
	return wrapProtocolHttpsUrl(formatSocialProfileRunUri(entityHash))
}
