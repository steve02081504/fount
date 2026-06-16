/**
 * Social / 时间线远程入站 ed25519 验签（sender 为 pubKeyHash，公钥来自 senderPubKey）。
 */
import { Buffer } from 'node:buffer'

import { pubKeyHash, verify } from '../crypto.mjs'
import { eventBodyForSign, signPayloadBytes } from '../dag/index.mjs'
import { isHex64, isSignatureHex128 } from '../hexIds.mjs'

/**
 * @param {object} event 含 signature、sender、senderPubKey 的签名事件
 * @returns {Promise<boolean>} 验签是否通过
 */
export async function verifyTimelineRemoteSignature(event) {
	const sender = String(event?.sender || '').trim().toLowerCase()
	if (!isHex64(sender)) return false
	const signatureHex = String(event?.signature || '').trim()
	if (!isSignatureHex128(signatureHex)) return false
	const pubKeyHex = String(event?.senderPubKey || '').trim().toLowerCase()
	if (!isHex64(pubKeyHex)) return false
	const publicKeyBytes = new Uint8Array(Buffer.from(pubKeyHex, 'hex'))
	if (pubKeyHash(publicKeyBytes) !== sender) return false
	const signatureBytes = new Uint8Array(Buffer.from(signatureHex, 'hex'))
	return await verify(signatureBytes, signPayloadBytes(eventBodyForSign(event)), publicKeyBytes)
}
