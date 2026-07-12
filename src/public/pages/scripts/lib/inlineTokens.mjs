/** inline token 唯一 tokenizer（chat/social 共用）。 */
import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id_parse'

/** @typedef {'entity' | 'role' | 'everyone' | 'emoji' | 'channel'} InlineTokenKind */

/** @typedef {{ kind: InlineTokenKind, body: string, start: number, end: number }} InlineToken */

const INLINE_TOKEN_RE = /@\[([^\]]+)\]|#\[([\w.-]+)\/([\w.-]+)\]|#\[([\w.-]+)\](?!\/\w)|:\[([\w.-]+)\/([\w.-]+)\](?!:)/giu

/**
 * @param {string} mentionBody @[] 内正文
 * @returns {InlineToken | null}
 */
function parseBracketMention(mentionBody, start, end) {
	const body = String(mentionBody || '').trim()
	if (!body) return null
	if (body === 'everyone' || body === 'here')
		return { kind: 'everyone', body, start, end }
	if (body.startsWith('role:'))
		return { kind: 'role', body: body.slice('role:'.length), start, end }
	if (isEntityHash128(body.toLowerCase()))
		return { kind: 'entity', body: body.toLowerCase(), start, end }
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
		if (match[2] !== undefined && match[3] !== undefined) {
			tokens.push({ kind: 'channel', body: `${match[2]}/${match[3]}`, start, end })
			continue
		}
		if (match[4] !== undefined) {
			tokens.push({ kind: 'channel', body: match[4], start, end })
			continue
		}
		if (match[5] !== undefined && match[6] !== undefined)
			tokens.push({ kind: 'emoji', body: `${match[5]}/${match[6]}`, start, end })
	}
	return tokens
}
