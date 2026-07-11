/**
 * 将正文中的 `@128hex` 展开为 Markdown 链接（展示 displayName）。
 */
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
 * @returns {string} 展开后的 Markdown
 */
export function expandMentionsInMarkdown(text, labelMap) {
	return String(text || '').replace(/@([\da-f]{128})/giu, (_match, hashRaw) => {
		const hash = hashRaw.toLowerCase()
		const label = labelMap.get(hash)
			|| formatHashShort(hash, { headLen: 8, tailLen: 0, ellipsis: false })
		return `[@${label}](${formatSocialProfileHref(hash)})`
	})
}
