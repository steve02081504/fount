/** §9：social runUri 与 chat 互跳。 */

/**
 * Social runUri part 路径前缀。
 * protocolhandler 用 `replaceAll(':', '/')` 还原成 loadPart 路径 `shells/social`，故必须是 `shells:social`。
 */
const SOCIAL_RUN_PART = 'shells:social'
const RUN_PREFIX = `fount://run/${SOCIAL_RUN_PART}/`

/**
 * 构建 fount Social runUri 字符串。
 * @param {string} subcommand 子命令
 * @param {string[]} segments 分号分段
 * @returns {string} fount runUri
 */
function buildRunUri(subcommand, segments) {
	const body = [subcommand, ...segments.map(segment => encodeURIComponent(segment || ''))].join(';')
	return `${RUN_PREFIX}${body}`
}

/**
 * 生成 profile 深链 runUri。
 * @param {string} entityHash 128 位 entityHash
 * @param {string} [postId] 帖子 id
 * @returns {string} profile runUri
 */
export function formatSocialProfileRunUri(entityHash, postId) {
	if (postId) return buildRunUri('profile', [entityHash, postId])
	return buildRunUri('profile', [entityHash])
}

/**
 * 话题 / 关键词搜索深链（hash 路由）。
 * @param {string} query 搜索词（可含 `#`）
 * @returns {string} 浏览器 hash 链接
 */
export function formatSocialSearchHref(query) {
	const q = String(query || '').trim()
	if (q.startsWith('#'))
		return `/parts/shells:social/#search;${encodeURIComponent(q.slice(1))}`
	return `/parts/shells:social/#search;${encodeURIComponent(q)}`
}

/**
 * 生成从 Social 跳转 Chat Hub 私信的链接。
 * @param {string} entityHash 目标 entityHash（打开 Chat Hub 联系/私信）
 * @returns {string} Chat hub 联系链接
 */
export function formatChatDmFromSocial(entityHash) {
	return `/parts/shells:chat/hub/?contact=${encodeURIComponent(entityHash)}`
}
