/** inline token 唯一 tokenizer（chat/social 共用；勿用 /scripts/ 绝对路径）。 */
import { isEntityHash128 } from 'https://esm.sh/@steve02081504/fount-p2p/core/entity_id_parse'

import { INLINE_TOKEN_RE } from './inlineTokenSyntax.mjs'

/** @typedef {'entity' | 'role' | 'everyone' | 'emoji' | 'channel' | 'group' | 'message'} InlineTokenKind */

/** @typedef {{ kind: InlineTokenKind, body: string, start: number, end: number }} InlineToken */

/**
 * @param {string} mentionBody @[] 内正文
 * @param {number} start token 起始偏移
 * @param {number} end token 结束偏移
 * @returns {InlineToken | null} 解析后的 mention token；无法识别则为 null
 */
function parseBracketMention(mentionBody, start, end) {
	const body = String(mentionBody || '').trim()
	if (!body) return null
	if (body.startsWith('role:')) {
		const roleId = body.slice('role:'.length).trim()
		if (!roleId) return null
		if (roleId === 'everyone' || roleId === 'here')
			return { kind: 'everyone', body: roleId, start, end }
		return { kind: 'role', body: roleId, start, end }
	}
	if (body.startsWith('entity:')) {
		const hash = body.slice('entity:'.length).trim().toLowerCase()
		if (isEntityHash128(hash))
			return { kind: 'entity', body: hash, start, end }
	}
	return null
}

/**
 * @param {string} text 正文
 * @returns {InlineToken[]} 按出现顺序的 token 列表
 */
export function parseInlineTokens(text) {
	const source = String(text || '')
	/** @type {InlineToken[]} */
	const tokens = []
	let match
	INLINE_TOKEN_RE.lastIndex = 0
	while ((match = INLINE_TOKEN_RE.exec(source)) !== null) {
		const start = match.index
		const end = start + match[0].length
		if (match[1] !== undefined) {
			const mention = parseBracketMention(match[1], start, end)
			if (mention) tokens.push(mention)
			continue
		}
		if (match[2] !== undefined && match[3] !== undefined && match[4] !== undefined) {
			tokens.push({
				kind: 'message',
				body: `${match[2]}/${match[3]}/${match[4]}`,
				start,
				end,
			})
			continue
		}
		if (match[5] !== undefined && match[6] !== undefined) {
			tokens.push({ kind: 'channel', body: `${match[5]}/${match[6]}`, start, end })
			continue
		}
		if (match[7] !== undefined) {
			tokens.push({ kind: 'group', body: match[7], start, end })
			continue
		}
		if (match[8] !== undefined && match[9] !== undefined)
			tokens.push({ kind: 'emoji', body: `${match[8]}/${match[9]}`, start, end })
	}
	return tokens
}
