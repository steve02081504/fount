/** §9：social runUri 与 chat 互跳。 */

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
 * @param {string} entityHash 128 位 entityHash
 * @param {string} [postId] 帖子 id
 * @returns {string} profile runUri
 */
export function formatSocialProfileRunUri(entityHash, postId) {
	if (postId) return buildRunUri('profile', [entityHash, postId])
	return buildRunUri('profile', [entityHash])
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
