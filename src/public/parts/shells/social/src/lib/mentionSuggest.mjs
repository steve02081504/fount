import { formatHashShort } from 'fount/public/parts/shells/chat/public/shared/entityHash.mjs'

import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../chat/src/entity/identity.mjs'
import { listLocalAgentEntities } from '../federation/hosting.mjs'
import { loadFollowing } from '../following.mjs'

import { getEntityProfile } from './entityProfile.mjs'


/**
 * 返回发帖 @ 提及 autocomplete 候选列表。
 * @param {string} username 用户
 * @param {string} [query] 过滤关键词
 * @param {number} [limit=20] 条数上限
 * @returns {Promise<{ suggestions: object[] }>} @ 提及候选
 */
export async function suggestMentions(username, query = '', limit = 20) {
	const normalizedQuery = query.trim().toLowerCase()
	/** @type {object[]} */
	const suggestions = []
	const seen = new Set()

	/**
	 * 将 @ 提及候选加入结果集（去重与关键词过滤）。
	 * @param {{ entityHash?: string, displayName?: string, charPartName?: string }} suggestion 候选条目
	 * @returns {void}
	 */
	function pushSuggestion(suggestion) {
		const entityHash = suggestion.entityHash.toLowerCase()
		if (!entityHash || seen.has(entityHash)) return
		if (normalizedQuery && !entityHash.includes(normalizedQuery)
			&& !String(suggestion.displayName || '').toLowerCase().includes(normalizedQuery)
			&& !String(suggestion.charPartName || '').toLowerCase().includes(normalizedQuery))
			return
		seen.add(entityHash)
		suggestions.push(suggestion)
	}

	const selfEntityHash = await resolveOperatorEntityHash(username)
	if (selfEntityHash) {
		const profile = await getEntityProfile(username, selfEntityHash)
		pushSuggestion({
			entityHash: selfEntityHash,
			displayName: profile?.name || formatHashShort(selfEntityHash, { headLen: 8, tailLen: 0, ellipsis: false }),
			kind: 'self',
		})
	}

	const { following } = await loadFollowing(username)
	for (const entityHash of following) {
		const profile = await getEntityProfile(username, entityHash)
		pushSuggestion({
			entityHash,
			displayName: profile?.name || formatHashShort(entityHash, { headLen: 8, tailLen: 0 }),
			kind: 'following',
		})
	}

	for (const { entityHash, charPartName } of listLocalAgentEntities(username)) {
		const profile = await getEntityProfile(username, entityHash)
		pushSuggestion({
			entityHash,
			displayName: profile?.name || charPartName,
			charPartName,
			kind: 'agent',
		})
	}

	return { suggestions: suggestions.slice(0, Math.min(50, Math.max(1, limit))) }
}
