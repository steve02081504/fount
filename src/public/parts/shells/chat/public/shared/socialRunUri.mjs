const SOCIAL_RUN_PART = 'shells:social'

/**
 * @param {string} entityHash 128 位 entityHash
 * @param {string} [postId] 帖子 id
 * @returns {string} 浏览器 hash 链接
 */
export function formatSocialProfileHref(entityHash, postId) {
	return `/parts/shells:social/#${postId ? `profile;${entityHash};${postId}` : `profile;${entityHash}`}`
}

/**
 * @param {string} raw hash 或 runUri
 * @returns {{ subcommand: string, entityHash?: string, postId?: string, searchQuery?: string } | null} 解析结果
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
	if (subcommand === 'profile')
		return { subcommand, entityHash: parts[1], postId: parts[2] }
	if (subcommand === 'search')
		return { subcommand, searchQuery: parts.slice(1).join(';') }
	return subcommand ? { subcommand, entityHash: parts[1] } : null
}
