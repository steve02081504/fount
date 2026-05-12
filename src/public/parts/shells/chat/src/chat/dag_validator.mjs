import { Buffer } from 'node:buffer'

import { pubKeyHash, verify } from '../../../../../../scripts/p2p/crypto.mjs'
import { signPayloadBytes, sortedPrevEventIds } from '../../../../../../scripts/p2p/dag.mjs'

/** 64 位十六进制小写公钥哈希（发件人标识）格式校验。 */
export const PUB_KEY_HASH_HEX = /^[0-9a-f]{64}$/iu

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
 * 校验事件 Ed25519 签名：发件人为成员公钥哈希时必须带有效签名；本地别名可免签。
 * @param {string} username 用户名（与调用方签名对齐，当前未参与校验逻辑）
 * @param {string} chatId 群组 ID（与调用方签名对齐，当前未参与校验逻辑）
 * @param {object} body `unsignedEventFields` 得到的 unsigned 体
 * @param {{ id: string, signature?: string, senderPubKey?: string }} signPayload 含签名与可选发件人公钥的载荷
 * @param {{ senderPubKey?: string }} eventLike 与原始事件类似的元数据来源
 * @param {Uint8Array} [secretKey] 本地签署时用于推导公钥的密钥
 * @param {{ members: Map<string, { pubKeyHex?: string }> }} [materializedState] 物化群状态，用于从成员表解析发件人公钥（避免循环依赖，由调用方注入）
 * @returns {Promise<void>} 校验通过则正常返回；失败抛出 `Error`
 */
export async function validateSignature(username, chatId, body, signPayload, eventLike, secretKey, materializedState) {
	void username
	void chatId
	const sender = String(body.sender || '')
	const signatureHex = typeof signPayload.signature === 'string' ? signPayload.signature.trim() : ''
	const signatureBytes = signatureHex ? Buffer.from(signatureHex, 'hex') : null
	const hasSignature = !!(signatureBytes && signatureBytes.length === 64)

	if (!PUB_KEY_HASH_HEX.test(sender)) {
		if (!hasSignature) return
		const publicKeyHex = eventLike.senderPubKey || signPayload.senderPubKey
		if (!publicKeyHex || String(publicKeyHex).length !== 64)
			throw new Error('signature present but missing sender public key')
		const publicKeyBuffer = Buffer.from(String(publicKeyHex), 'hex')
		if (publicKeyBuffer.length !== 32) throw new Error('Invalid senderPubKey length')
		const signatureValid = await verify(new Uint8Array(signatureBytes), signPayloadBytes(body), new Uint8Array(publicKeyBuffer))
		if (!signatureValid) throw new Error('Invalid event signature')
		return
	}

	if (!hasSignature) throw new Error('signed events require signature (sender is pubKeyHash)')

	/** @type {Uint8Array | null} */
	let publicKeyBytes = null
	if (secretKey) {
		const { getPublicKey } = await import('npm:@noble/ed25519')
		publicKeyBytes = getPublicKey(secretKey.slice(0, 32))
	}
	else {
		const inlinePublicKeyHex = eventLike.senderPubKey || signPayload.senderPubKey
		if (inlinePublicKeyHex && String(inlinePublicKeyHex).length === 64) {
			const buffer = Buffer.from(String(inlinePublicKeyHex), 'hex')
			if (buffer.length === 32) publicKeyBytes = new Uint8Array(buffer)
		}
		if (!publicKeyBytes) {
			const contentObject = eventLike.content && typeof eventLike.content === 'object' ? eventLike.content : {}
			const fromContent = contentObject.pubKeyHex || contentObject.pubKey
			if (fromContent && String(fromContent).length === 64) {
				const buffer = Buffer.from(String(fromContent).replace(/^0x/iu, ''), 'hex')
				if (buffer.length === 32) publicKeyBytes = new Uint8Array(buffer)
			}
		}
		if (!publicKeyBytes && materializedState) {
			const members = materializedState.members
			const memberRecord = typeof members?.get === 'function'
				? members.get(sender)
				: members && typeof members === 'object'
					? members[sender]
					: undefined
			const memberPubKeyHex = memberRecord?.pubKeyHex
			if (memberPubKeyHex) {
				const buffer = Buffer.from(String(memberPubKeyHex).replace(/^0x/iu, ''), 'hex')
				if (buffer.length === 32) publicKeyBytes = new Uint8Array(buffer)
			}
		}
	}
	if (!publicKeyBytes) throw new Error('cannot verify: missing public key for sender hash')

	if (pubKeyHash(publicKeyBytes).toLowerCase() !== sender.toLowerCase())
		throw new Error('sender public key does not match sender hash')

	const signatureValid = await verify(new Uint8Array(signatureBytes), signPayloadBytes(body), publicKeyBytes)
	if (!signatureValid) throw new Error('Invalid event signature')
}
