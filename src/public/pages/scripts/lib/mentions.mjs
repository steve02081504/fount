/** @ 提及解析（chat/social 共用；浏览器与 Deno 均可加载）。 */
import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id_parse'

import { parseInlineTokens } from './inlineTokens.mjs'

/**
 * @param {string} text 正文
 * @returns {string[]} 去重后的 entityHash（小写）
 */
export function extractMentionEntityHashes(text) {
	const hashes = []
	for (const token of parseInlineTokens(text)) {
		if (token.kind === 'entity' && isEntityHash128(token.body))
			hashes.push(token.body)
	}
	return [...new Set(hashes)]
}

/**
 * @param {string} text 正文
 * @returns {string[]} 去重后的 roleId
 */
export function extractMentionRoleIds(text) {
	const roleIds = []
	for (const token of parseInlineTokens(text)) {
		if (token.kind === 'role' && token.body)
			roleIds.push(token.body)
	}
	return [...new Set(roleIds)]
}

/**
 * @param {string} text 正文
 * @returns {boolean} 是否含 @[everyone]
 */
export function hasEveryoneToken(text) {
	return parseInlineTokens(text).some(token => token.kind === 'everyone' && token.body === 'everyone')
}

/**
 * @param {string} text 正文
 * @returns {boolean} 是否含 @[here]
 */
export function hasHereToken(text) {
	return parseInlineTokens(text).some(token => token.kind === 'everyone' && token.body === 'here')
}

/**
 * @param {string} text 正文
 * @param {{ canMentionEveryone?: boolean, ingress?: 'live' | 'backfill' }} [options] 权限与入账语义
 * @returns {{ entityHashes: string[], roleIds: string[], everyone: boolean }}
 */
export function buildMentionsStructure(text, options = {}) {
	const canMentionEveryone = options.canMentionEveryone === true
	const ingress = options.ingress === 'backfill' ? 'backfill' : 'live'
	const entityHashes = []
	const roleIds = []
	let everyone = false
	for (const token of parseInlineTokens(text)) {
		if (token.kind === 'entity' && isEntityHash128(token.body))
			entityHashes.push(token.body)
		else if (token.kind === 'role' && canMentionEveryone && token.body)
			roleIds.push(token.body)
		else if (token.kind === 'everyone' && canMentionEveryone) {
			if (token.body === 'everyone') everyone = true
			else if (token.body === 'here' && ingress === 'live') everyone = true
		}
	}
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
	const hash = String(entityHash || '').trim().toLowerCase()
	if (!hash || !mentions?.entityHashes?.length) return false
	return mentions.entityHashes.some(entry => String(entry).trim().toLowerCase() === hash)
}
