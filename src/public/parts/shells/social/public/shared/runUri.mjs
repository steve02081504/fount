/** social runUri 与 chat 互跳；外部分享经 Pages protocol 中转。 */

const SOCIAL_RUN_PART = 'shells:social'
const RUN_PREFIX = `fount://run/${SOCIAL_RUN_PART}/`

/**
 * @param {string} subcommand 子命令
 * @param {string[]} segments 分号分段
 * @returns {string} fount runUri
 */
function buildRunUri(subcommand, segments) {
	const body = [subcommand, ...segments.map(segment => encodeURIComponent(segment || ''))].join(';')
	return `${RUN_PREFIX}${body}`
}

/**
 * @param {string} fountRunUri `fount://run/…`
 * @returns {string} GitHub Pages protocol 桥接 URL
 */
export function wrapProtocolHttpsUrl(fountRunUri) {
	return `https://steve02081504.github.io/fount/protocol?url=${encodeURIComponent(fountRunUri)}`
}

/**
 * @param {string} entityHash 128 位 entityHash
 * @param {string} [postId] 帖子 id
 * @returns {string} profile runUri
 */
export function formatSocialProfileRunUri(entityHash, postId) {
	if (postId) return buildRunUri('profile', [entityHash, postId])
	return buildRunUri('profile', [entityHash])
}

/**
 * @param {string} entityHash 作者 entityHash
 * @param {string} [postId] 帖子 id
 * @returns {string} 外部分享用 https 链接（经 Pages 中转到读者本机实例）
 */
export function formatSocialShareHttpsUrl(entityHash, postId) {
	return wrapProtocolHttpsUrl(formatSocialProfileRunUri(entityHash, postId))
}

/**
 * @param {string} query 搜索词
 * @returns {string} 浏览器 hash 链接
 */
export function formatSocialSearchHref(query) {
	const q = String(query || '').trim()
	if (q.startsWith('#'))
		return `/parts/shells:social/#search;${encodeURIComponent(q.slice(1))}`
	return `/parts/shells:social/#search;${encodeURIComponent(q)}`
}

/**
 * @param {string} entityHash 目标 entityHash
 * @returns {string} Chat hub 联系链接
 */
export function formatChatDmFromSocial(entityHash) {
	return `/parts/shells:chat/hub/?contact=${encodeURIComponent(entityHash)}`
}
