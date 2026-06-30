import { Buffer } from 'node:buffer'

import { canonicalStringify } from './canonical_json.mjs'
import { sign, verify } from './crypto.mjs'

/**
 * 为 checkpoint 载荷附加签名（签名字段不包含 `checkpoint_signature` 自身）。
 * @param {object} payload 待签名载荷
 * @param {Uint8Array} secretKey 32 字节种子私钥
 * @returns {Promise<object>} 带 `checkpoint_signature` 的载荷
 */
export async function signCheckpoint(payload, secretKey) {
	const body = { ...payload }
	delete body.checkpoint_signature
	const messageBytes = Buffer.from(canonicalStringify(body), 'utf8')
	const signature = await sign(messageBytes, secretKey)
	return { ...payload, checkpoint_signature: Buffer.from(signature).toString('hex') }
}

/**
 * 校验 `checkpoint_signature` 与载荷的一致性。
 * @param {object} checkpoint 完整检查点对象
 * @param {Uint8Array} ownerPublicKey 32 字节公钥
 * @returns {Promise<boolean>} 合法为 true
 */
export async function verifyCheckpointSignature(checkpoint, ownerPublicKey) {
	const raw = checkpoint.checkpoint_signature.trim()
	if (!/^[\da-f]{128}$/iu.test(raw)) return false
	const body = { ...checkpoint }
	delete body.checkpoint_signature
	const messageBytes = Buffer.from(canonicalStringify(body), 'utf8')
	return verify(Buffer.from(raw, 'hex'), messageBytes, ownerPublicKey)
}

/**
 * 判断 checkpoint 是否带合法 Ed25519 签名。
 * @param {object | null | undefined} checkpoint checkpoint 对象
 * @returns {boolean} 签名格式合法为 true
 */
export function isSignedCheckpoint(checkpoint) {
	return /^[\da-f]{128}$/iu.test(String(checkpoint?.checkpoint_signature || '').trim())
}
