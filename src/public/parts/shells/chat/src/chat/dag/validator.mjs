/**
 * 【文件】`dag/validator.mjs` — DAG 事件签名域与验签。
 * 【职责】抽取 unsigned 签名字段、校验 pubKeyHash 发件人是否附带有效 Ed25519 签名。
 * 【原理】`unsignedEventFields` 固定参与 `computeEventId` 的 canonical 字段；sender 须为 64 位 hex pubKeyHash 且带有效 Ed25519 签名；公钥来自成员表或载荷 `senderPubKey`。
 * 【数据结构】`body`（无 id/signature）、`signPayload`（含 `id`、`signature`、`senderPubKey`）；`PUB_KEY_HASH_HEX` 为发件人哈希正则。
 * 【关联】`append.mjs`、`remoteIngest.mjs`、`localSigner.mjs`、`scripts/p2p/dag`。
 */
import { Buffer } from 'node:buffer'

import { pubKeyHash, publicKeyFromSeed, verify } from 'npm:@steve02081504/fount-p2p/crypto'
import { signPayloadBytes, sortedPrevEventIds } from 'npm:@steve02081504/fount-p2p/dag/index'
import { HEX_ID_64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

/**
 * 发件人 pubKeyHash 的 64 位小写 hex 校验正则。
 */
export const PUB_KEY_HASH_HEX = HEX_ID_64

/**
 * 从事件中抽取参与事件 ID 计算与签名的无签名字段集合。
 * @param {object} event 原始 DAG 事件对象
 * @returns {object} 供 `computeEventId` / `signPayloadBytes` 使用的体对象
 */
export function unsignedEventFields(event) {
	return {
		type: event.type,
		groupId: event.groupId,
		channelId: event.channelId,
		sender: event.sender,
		charId: event.charId,
		timestamp: event.timestamp,
		hlc: event.hlc,
		prev_event_ids: sortedPrevEventIds(event.prev_event_ids),
		content: event.content,
		node_id: event.node_id,
	}
}

/**
 * @param {object} materializedState 物化群状态
 * @param {string} sender 发件人 pubKeyHash
 * @returns {object | undefined} 成员记录
 */
function memberRecord(materializedState, sender) {
	return materializedState?.members?.[sender]
}

/**
 * @param {unknown} hex 公钥十六进制
 * @returns {Uint8Array | null} 32 字节公钥
 */
function publicKeyBytesFromHex(hex) {
	const normalized = normalizeHex64(hex)
	if (!HEX_ID_64.test(normalized)) return null
	return new Uint8Array(Buffer.from(normalized, 'hex'))
}

/**
 * 校验事件签名：发件人须为 pubKeyHash 且带有效签名。
 * @param {object} body `unsignedEventFields` 得到的 unsigned 体
 * @param {{ id: string, signature?: string, senderPubKey?: string }} signPayload 含签名与可选发件人公钥的载荷
 * @param {{ senderPubKey?: string, content?: object }} eventLike 与原始事件类似的元数据来源
 * @param {Uint8Array} [secretKey] 本地签署时用于推导公钥的密钥
 * @param {object} [materializedState] 物化群状态，用于从成员表解析发件人公钥
 * @returns {Promise<void>} 校验通过则正常返回；失败抛出 `Error`
 */
export async function validateSignature(body, signPayload, eventLike, secretKey, materializedState) {
	const sender = body.sender?.trim().toLowerCase() || ''
	const signatureHex = signPayload.signature?.trim() || ''
	const signatureBytes = signatureHex ? Buffer.from(signatureHex, 'hex') : null

	if (!PUB_KEY_HASH_HEX.test(sender))
		throw new Error('signed events require sender to be pubKeyHash')
	if (signatureBytes?.length !== 64) throw new Error('signed events require signature')

	let publicKeyBytes = null
	if (secretKey)
		publicKeyBytes = publicKeyFromSeed(secretKey)
	else
		publicKeyBytes = publicKeyBytesFromHex(signPayload.senderPubKey)
			|| publicKeyBytesFromHex(memberRecord(materializedState, sender)?.pubKeyHex)

	if (!publicKeyBytes) throw new Error('cannot verify: missing public key for sender hash')

	if (pubKeyHash(publicKeyBytes).toLowerCase() !== sender.toLowerCase())
		throw new Error('sender public key does not match sender hash')

	if (!await verify(new Uint8Array(signatureBytes), signPayloadBytes(body), publicKeyBytes))
		throw new Error('Invalid event signature')
}
