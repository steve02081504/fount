/**
 * 将正文中的 `@[...]` 展开为 Markdown 链接（展示 displayName / 角色名）。
 */
import { parseInlineTokens } from '/scripts/lib/inlineTokens.mjs'

import { formatHashShort } from './entityHash.mjs'
import { formatSocialProfileHref } from './socialRunUri.mjs'


/**
 * @param {Array<{ entityHash?: string, displayName?: string, profile?: { name?: string }, charname?: string }>} members 群成员列表
 * @param {{ viewerEntityHash?: string, viewerDisplayName?: string }} [viewer] 本机 viewer
 * @returns {Map<string, string>} entityHash → 展示名
 */
export function buildMentionLabelMap(members = [], viewer = {}) {
	/** @type {Map<string, string>} */
	const map = new Map()
	for (const member of members) {
		const hash = String(member.entityHash || '').trim().toLowerCase()
		if (!hash) continue
		const label = String(member.displayName || member.profile?.name || member.charname || '').trim()
			|| formatHashShort(hash, { headLen: 8, tailLen: 0, ellipsis: false })
		map.set(hash, label)
	}
	const viewerHash = String(viewer.viewerEntityHash || '').trim().toLowerCase()
	if (viewerHash && !map.has(viewerHash)) {
		const label = String(viewer.viewerDisplayName || '').trim()
			|| formatHashShort(viewerHash, { headLen: 8, tailLen: 0, ellipsis: false })
		map.set(viewerHash, label)
	}
	return map
}

/**
 * @param {object | null | undefined} hubState hubStore.context.currentState
 * @param {{ viewerEntityHash?: string, viewerDisplayName?: string }} [viewer] hubStore.viewer
 * @returns {Map<string, string>} entityHash → 展示名
 */
export function buildMentionLabelMapFromHubState(hubState, viewer = {}) {
	return buildMentionLabelMap(hubState?.members || [], {
		viewerEntityHash: viewer.viewerEntityHash || hubState?.viewerEntityHash,
		viewerDisplayName: viewer.viewerDisplayName,
	})
}

/**
 * @param {string} text 原始正文
 * @param {Map<string, string>} labelMap entityHash → 展示名
 * @param {{ roleNames?: Map<string, string> | Record<string, string> }} [options] 角色展示名
 * @returns {string} 展开后的 Markdown
 */
export function expandMentionsInMarkdown(text, labelMap, options = {}) {
	const roleNames = options.roleNames instanceof Map
		? options.roleNames
		: new Map(Object.entries(options.roleNames || {}))
	const source = String(text || '')
	if (!source.includes('@[')) return source
	/** @type {string[]} */
	const parts = []
	let cursor = 0
	for (const token of parseInlineTokens(source)) {
		if (!token.kind || token.kind === 'emoji' || token.kind === 'channel') continue
		if (token.start > cursor) parts.push(source.slice(cursor, token.start))
		if (token.kind === 'entity') {
			const hash = token.body.toLowerCase()
			const label = labelMap.get(hash)
				|| formatHashShort(hash, { headLen: 8, tailLen: 0, ellipsis: false })
			parts.push(`[@${label}](${formatSocialProfileHref(hash)})`)
		}
		else if (token.kind === 'role') {
			const label = roleNames.get(token.body) || token.body
			parts.push(`@${label}`)
		}
		else if (token.kind === 'everyone')
			parts.push(token.body === 'here' ? '@here' : '@everyone')
		cursor = token.end
	}
	if (cursor < source.length) parts.push(source.slice(cursor))
	return parts.join('')
}
