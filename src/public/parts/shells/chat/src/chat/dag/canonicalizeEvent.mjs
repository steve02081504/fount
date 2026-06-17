/**
 * Chat 群 DAG 事件入库 canonicalize（形状规范化，非权限校验）。
 */
import { canonicalizeChatContent } from '../../../../../../../scripts/p2p/dag/canonicalize_presets.mjs'
import { canonicalizeSignedRow } from '../../../../../../../scripts/p2p/dag/canonicalizeRow.mjs'
import { stripDagEventLocalExtensions } from '../../../../../../../scripts/p2p/dag/strip_extensions.mjs'
import { validateRemoteEventShape } from '../../../../../../../scripts/p2p/schemas/remote_event.mjs'

/**
 * @param {object} event 签名事件
 * @returns {object} canonical 行
 */
export function canonicalizeSignedChatEvent(event) {
	const out = canonicalizeSignedRow(event, {
		prepare: stripDagEventLocalExtensions,
		contentHexKeys: new Set(),
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
