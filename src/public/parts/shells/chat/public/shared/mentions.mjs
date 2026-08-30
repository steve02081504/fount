/** 提及解析（chat/social 共用；浏览器 / Deno / Node 均可加载）。 */
import { parseInlineTokens } from './inlineTokens.mjs'
import { escapeHtml } from './escapeHtml.mjs'

/**
 * @param {string} label 提及展示名（displayName / 角色名）
 * @returns {string} 转义后的 markdown 文本（防 `<img onerror>` 之类 raw HTML 借 trusted 档执行）
 */
export function escapeMentionLabel(label) {
	return escapeHtml(String(label ?? ''))
}

/**
 * @param {string} text 正文
 * @returns {string[]} 去重后的 entityHash（原样保留大小写）
 */
export function extractMentionEntityHashes(text) {
	const hashes = []
	for (const token of parseInlineTokens(text))
		if (token.kind === 'entity')
			hashes.push(token.body)

	return [...new Set(hashes)]
}

/**
 * @param {string} text 正文
 * @returns {string[]} 去重后的 roleId
 */
export function extractMentionRoleIds(text) {
	const roleIds = []
	for (const token of parseInlineTokens(text))
		if (token.kind === 'role' && token.body)
			roleIds.push(token.body)

	return [...new Set(roleIds)]
}

/**
 * @param {string} text 正文
 * @returns {boolean} 是否含 @[role:everyone]
 */
export function hasEveryoneToken(text) {
	return parseInlineTokens(text).some(token => token.kind === 'everyone' && token.body === 'everyone')
}

/**
 * @param {string} text 正文
 * @returns {boolean} 是否含 @[role:here]
 */
export function hasHereToken(text) {
	return parseInlineTokens(text).some(token => token.kind === 'everyone' && token.body === 'here')
}

/**
 * @param {string} text 正文
 * @param {{ canMentionEveryone?: boolean, ingress?: 'live' | 'backfill' }} [options] 权限与入账语义
 * @returns {{ entityHashes: string[], roleIds: string[], everyone: boolean }} 提及结构
 */
export function buildMentionsStructure(text, options = {}) {
	const canMentionEveryone = options.canMentionEveryone === true
	const ingress = options.ingress === 'backfill' ? 'backfill' : 'live'
	const entityHashes = []
	const roleIds = []
	let everyone = false
	for (const token of parseInlineTokens(text))
		if (token.kind === 'entity')
			entityHashes.push(token.body)
		else if (token.kind === 'role' && canMentionEveryone && token.body)
			roleIds.push(token.body)
		else if (token.kind === 'everyone' && canMentionEveryone)
			if (token.body === 'everyone') everyone = true
			else if (token.body === 'here' && ingress === 'live') everyone = true


	return {
		entityHashes: [...new Set(entityHashes)],
		roleIds: [...new Set(roleIds)],
		everyone,
	}
}

/**
 * @param {{ entityHashes?: string[] }} mentions mentions 结构
 * @param {string} entityHash 待查实体
 * @returns {boolean} 是否直接 @ 命中
 */
export function mentionsEntity(mentions, entityHash) {
	if (!entityHash || !mentions?.entityHashes?.length) return false
	return mentions.entityHashes.some(entry => entry === entityHash)
}
