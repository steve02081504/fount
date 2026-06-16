/** §9：social runUri 与 chat 互跳。 */

/** Social runUri part 路径前缀。 */
export const SOCIAL_RUN_PART = 'parts:shells:social'
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
 * 浏览器内导航用的 profile 深链（hash 路由）。
 * @param {string} entityHash 128 位 entityHash
 * @param {string} [postId] 帖子 id
 * @returns {string} 浏览器 hash 链接
 */
export function formatSocialProfileHref(entityHash, postId) {
	const hash = postId ? `profile;${entityHash};${postId}` : `profile;${entityHash}`
	return `/parts/shells:social/#${hash}`
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

/**
 * 解析 hash 或 runUri 为 Social 导航结构。
 * @param {string} raw hash 或 runUri
 * @returns {{ subcommand: string, entityHash?: string, postId?: string } | null} 解析结果
 */
export function parseSocialRunUri(raw) {
	let input = String(raw || '').trim()
	if (!input) return null
	if (input.startsWith('fount://run/')) input = input.slice('fount://run/'.length)
	if (input.startsWith(`${SOCIAL_RUN_PART}/`))
		input = input.slice(SOCIAL_RUN_PART.length + 1)
	else if (input.startsWith(`${SOCIAL_RUN_PART};`))
		input = input.slice(SOCIAL_RUN_PART.length + 1)

	const parts = input.split(';').map(segment => {
		try { return decodeURIComponent(segment) }
		catch { return segment }
	})
	const subcommand = parts[0]?.trim()
	if (subcommand === 'profile')
		return { subcommand, entityHash: parts[1], postId: parts[2] }
	if (subcommand === 'search')
		return { subcommand, searchQuery: parts.slice(1).join(';') }
	return subcommand ? { subcommand, entityHash: parts[1] } : null
}
