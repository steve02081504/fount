/**
 * 将正文中的 `@[...]` 展开为 Markdown 链接（展示 displayName / 角色名）。
 */
import { parseInlineTokens } from '/scripts/lib/inlineTokens.mjs'

import { aliasForEntity } from './aliases.mjs'
import { formatHashShort } from './entityHash.mjs'
import { disambiguateLabels } from './nameResolve.mjs'
import { formatSocialProfileHref } from './socialRunUri.mjs'


/**
 * @param {Array<{ entityHash?: string, displayName?: string, profile?: { name?: string }, charname?: string }>} members 群成员列表
 * @param {{ viewerEntityHash?: string, viewerDisplayName?: string }} [viewer] 本机 viewer
 * @returns {Map<string, string>} entityHash → 展示名
 */
export function buildMentionLabelMap(members = [], viewer = {}) {
	/** @type {Array<{ entityHash: string, label: string }>} */
	const items = []
	const seen = new Set()
	const push = (hash, name) => {
		const key = String(hash || '').trim().toLowerCase()
		if (!key || seen.has(key)) return
		seen.add(key)
		const label = aliasForEntity(key) || String(name || '').trim()
			|| formatHashShort(key, { headLen: 8, tailLen: 0, ellipsis: false })
		items.push({ entityHash: key, label })
	}
	for (const member of members)
		push(member.entityHash, member.displayName || member.profile?.name || member.charname)
	push(viewer.viewerEntityHash, viewer.viewerDisplayName)

	const labels = disambiguateLabels(items)
	/** @type {Map<string, string>} */
	const map = new Map()
	items.forEach((item, index) => map.set(item.entityHash, labels[index]))
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
