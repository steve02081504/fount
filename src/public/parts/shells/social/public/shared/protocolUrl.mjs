/**
 * 跨壳 protocol URL：定义在 chat，Social 仅 re-export（浏览器模块；勿被 Deno 纯测 import）。
 */
import { wrapProtocolHttpsUrl } from '/parts/shells:chat/shared/runUri.mjs'

import {
	formatSocialPostPageUri,
	formatSocialPostRunUri,
	formatSocialProfilePageUri,
	formatSocialProfileRunUri,
} from './runUri.mjs'

/**
 *
 */
export { wrapProtocolHttpsUrl }

/**
 * @param {string} entityHash 作者 entityHash
 * @param {string} [postId] 帖子 id
 * @param {string} [sharerNodeHash] 分享者本机 nodeHash（类比 Twitter s=N）
 * @returns {string} 外部分享用 https 链接
 */
export function formatSocialShareHttpsUrl(entityHash, postId, sharerNodeHash) {
	if (postId)
		return wrapProtocolHttpsUrl(formatSocialPostPageUri(entityHash, postId, sharerNodeHash))
	return wrapProtocolHttpsUrl(formatSocialProfilePageUri(entityHash, postId, sharerNodeHash))
}

/**
 * 兼容旧 run URI 分享（CLI / 深链）。
 * @param {string} entityHash 作者
 * @param {string} [postId] 帖子
 * @param {string} [sharerNodeHash] 分享者 nodeHash
 * @returns {string} run URI 形式的 https 分享链
 */
export function formatSocialShareRunHttpsUrl(entityHash, postId, sharerNodeHash) {
	if (postId)
		return wrapProtocolHttpsUrl(formatSocialPostRunUri(entityHash, postId, sharerNodeHash))
	return wrapProtocolHttpsUrl(formatSocialProfileRunUri(entityHash, postId))
}
