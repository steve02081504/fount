/**
 * Chat / Social DAG 事件 canonicalize 字段预设。
 */
import { canonicalizeRowContent } from './canonicalizeRow.mjs'

/**
 *
 */
export const MEMBER_KEY_RE = /^[\da-f]{64}$|^[\da-f]{128}$/u

/** Chat content 内 hex64 字段名 */
export const CHAT_CONTENT_HEX_KEYS = new Set([
	'targetId',
	'targetPubKeyHash',
	'targetNodeHash',
	'homeNodeHash',
	'introducerPubKeyHash',
	'delegatedOwnerPubKeyHash',
	'contentHash',
	'ciphertextHash',
	'from',
	'to',
	'charOwner',
])

/** Chat content 内 128 位 entityHash 字段名 */
export const CHAT_CONTENT_ENTITY_HASH_KEYS = new Set([
	'agentEntityHash',
	'targetEntityHash',
])

/** Social 时间线 canonicalize 选项 */
export const SOCIAL_TIMELINE_ROW_OPTS = {
	contentHexKeys: new Set([
		'targetPostId',
		'targetId',
	]),
	entityHashKeys: new Set([
		'targetEntityHash',
	]),
}

/**
 * @param {object | undefined} content 事件 content
 * @returns {object | undefined} 规范化后的 content
 */
export function canonicalizeChatContent(content) {
	if (!content) return content
	const out = canonicalizeRowContent(content, CHAT_CONTENT_HEX_KEYS, CHAT_CONTENT_ENTITY_HASH_KEYS)
	if (out?.targetMemberKey != null && out.targetMemberKey !== '') {
		const key = String(out.targetMemberKey).trim().toLowerCase()
		if (!MEMBER_KEY_RE.test(key))
			throw new Error('targetMemberKey must be 64 or 128 hex characters')
		out.targetMemberKey = key
	}
	return out
}
