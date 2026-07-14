/**
 * Chat 群 DAG 事件入库 canonicalize（形状规范化，非权限校验）。
 */
import { canonicalizeRowContent, canonicalizeSignedRow } from 'npm:@steve02081504/fount-p2p/dag/canonicalize_row'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'
import { validateRemoteEventShape } from 'npm:@steve02081504/fount-p2p/schemas/remote_event'

/**
 * 群成员键：仅 64-hex pubKeyHash。
 */
export const MEMBER_KEY_RE = /^[\da-f]{64}$/u

/** Chat content 内 hex64 字段名（bindingSig 为 128-hex 签名，勿列入） */
export const CHAT_CONTENT_HEX_KEYS = new Set([
	'ballotId',
	'targetId',
	'targetPubKeyHash',
	'targetNodeHash',
	'homeNodeHash',
	'introducerPubKeyHash',
	'delegatedOwnerPubKeyHash',
	'entityActivePubKeyHex',
	'contentHash',
	'ciphertextHash',
	'from',
	'to',
	'charOwner',
])

/** Chat content 内 128 位 entityHash 字段名 */
export const CHAT_CONTENT_ENTITY_HASH_KEYS = new Set([
	'entityHash',
	'ownerEntityHash',
	'targetEntityHash',
])

/**
 * @param {object | undefined} content 事件 content
 * @returns {object | undefined} 规范化后的 content
 */
export function canonicalizeChatContent(content) {
	if (!content) return content
	const out = canonicalizeRowContent(content, CHAT_CONTENT_HEX_KEYS, CHAT_CONTENT_ENTITY_HASH_KEYS)
	if (out?.bindingSig != null && out.bindingSig !== '')
		out.bindingSig = String(out.bindingSig).trim().toLowerCase().replace(/^0x/iu, '')
	if (out?.targetMemberKey != null && out.targetMemberKey !== '') {
		const key = String(out.targetMemberKey).trim().toLowerCase()
		if (!MEMBER_KEY_RE.test(key))
			throw new Error('targetMemberKey must be 64 hex characters')
		out.targetMemberKey = key
	}
	return out
}

/**
 * @param {object} event 签名事件
 * @returns {object} canonical 行
 */
export function canonicalizeSignedChatEvent(event) {
	const out = canonicalizeSignedRow(event, {
		prepare: stripDagEventLocalExtensions,
		contentHexKeys: CHAT_CONTENT_HEX_KEYS,
		entityHashKeys: CHAT_CONTENT_ENTITY_HASH_KEYS,
	})
	if (out.content)
		out.content = canonicalizeChatContent(out.content)
	return out
}

/**
 * @param {object} event 远程入站事件
 * @returns {object} canonical 行
 */
export function prepareInboundRemoteChatEvent(event) {
	validateRemoteEventShape(event)
	return canonicalizeSignedChatEvent(event)
}
