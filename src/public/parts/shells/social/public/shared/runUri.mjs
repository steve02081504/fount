/** social runUri 与 chat 互跳；外部分享经 Pages protocol 中转。 */

const SOCIAL_SHELL_PATH = '/parts/shells:social/'
const SOCIAL_RUN_PART = 'shells:social'
const RUN_PREFIX = `fount://run/${SOCIAL_RUN_PART}/`

/**
 * Social shell 实体资料页 hash 链接。
 * @param {string} entityHash 128 位 entityHash
 * @returns {string} 浏览器路径（含 hash）
 */
export function formatSocialProfileHref(entityHash) {
	return `${SOCIAL_SHELL_PATH}#profile;${entityHash}`
}

/**
 * Social shell 单帖详情页 hash 链接。
 * @param {string} entityHash 作者 entityHash
 * @param {string} postId 帖子 id
 * @param {string} [sharerNodeHash] 分享者 nodeHash（可选第 4 段）
 * @returns {string} 浏览器路径（含 hash）
 */
export function formatSocialPostHref(entityHash, postId, sharerNodeHash) {
	const segments = [`post;${entityHash};${postId}`]
	if (sharerNodeHash) segments[0] += `;${sharerNodeHash}`
	return `${SOCIAL_SHELL_PATH}#${segments[0]}`
}

/**
 * @param {string} raw hash 或 runUri
 * @returns {{ subcommand: string, entityHash?: string, postId?: string, sharerNodeHash?: string, searchQuery?: string } | null} 解析结果
 */
export function parseSocialRunUri(raw) {
	let input = raw.trim()
	if (!input) return null
	if (input.startsWith('fount://run/')) input = input.slice('fount://run/'.length)
	if (input.startsWith(`${SOCIAL_RUN_PART}/`) || input.startsWith(`${SOCIAL_RUN_PART};`))
		input = input.slice(SOCIAL_RUN_PART.length + 1)

	const parts = input.split(';').map(segment => {
		try { return decodeURIComponent(segment) }
		catch { return segment }
	})
	const subcommand = parts[0]?.trim()
	if (subcommand === 'profile' || subcommand === 'post')
		return {
			subcommand,
			entityHash: parts[1],
			postId: parts[2],
			...parts[3] && { sharerNodeHash: parts[3] },
		}
	if (subcommand === 'search')
		return { subcommand, searchQuery: parts.slice(1).join(';') }
	return subcommand ? { subcommand, entityHash: parts[1] } : null
}

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
 * @returns {string} profile runUri
 */
export function formatSocialProfileRunUri(entityHash) {
	return buildRunUri('profile', [entityHash])
}

/**
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {string} [sharerNodeHash] 分享者 nodeHash
 * @returns {string} post 详情 runUri
 */
export function formatSocialPostRunUri(entityHash, postId, sharerNodeHash) {
	if (sharerNodeHash) return buildRunUri('post', [entityHash, postId, sharerNodeHash])
	return buildRunUri('post', [entityHash, postId])
}

/**
 * 外部分享用 page 深链（protocolhandler 直接跳转，不经 runPart）。
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {string} [sharerNodeHash] 分享者 nodeHash
 * @returns {string} fount://page/… URI
 */
export function formatSocialPostPageUri(entityHash, postId, sharerNodeHash) {
	return `fount://page${formatSocialPostHref(entityHash, postId, sharerNodeHash)}`
}

/**
 * @param {string} entityHash 128 位 entityHash
 * @returns {string} profile page URI
 */
export function formatSocialProfilePageUri(entityHash) {
	return `fount://page${formatSocialProfileHref(entityHash)}`
}

/**
 * @param {string} query 搜索词
 * @returns {string} 浏览器 hash 链接
 */
export function formatSocialSearchHref(query) {
	const q = String(query || '').trim()
	if (q.startsWith('#'))
		return `${SOCIAL_SHELL_PATH}#search;${encodeURIComponent(q.slice(1))}`
	return `${SOCIAL_SHELL_PATH}#search;${encodeURIComponent(q)}`
}

/**
 * @param {string} tag 话题标签（不含 #）
 * @returns {string} 话题页浏览器 hash 链接
 */
export function formatSocialTopicHref(tag) {
	const t = String(tag || '').trim().replace(/^#/, '')
	return `${SOCIAL_SHELL_PATH}#topic:${encodeURIComponent(t)}`
}

/**
 * @param {string} entityHash 目标 entityHash
 * @returns {string} Chat hub 联系链接
 */
export function formatChatDmFromSocial(entityHash) {
	return `/parts/shells:chat/hub/?contact=${encodeURIComponent(entityHash)}`
}
