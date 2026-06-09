/**
 * 联邦补拉 HPKE 响应封装与解包。
 */
import { encryptUtf8ForMember, decryptUtf8ForMember } from '../../../../../../../scripts/p2p/key_crypto.mjs'

/**
 * @param {string} recipientEdPubKeyHex 接收方 Ed25519 公钥 hex
 * @param {object} inner 明文 inner（events、gshGrant 等）
 * @returns {{ ephemPub: string, iv: string, ciphertext: string, authTag: string }} ECIES 外层密文对象
 */
export function wrapPullResponseInner(recipientEdPubKeyHex, inner) {
	return encryptUtf8ForMember(JSON.stringify(inner), recipientEdPubKeyHex)
}

/**
 * @param {{ ephemPub: string, iv: string, ciphertext: string, authTag: string }} envelope ECIES 四元组
 * @param {Uint8Array} secretKeySeed 本机 Ed25519 私钥种子
 * @returns {object | null} 解析后的 inner 对象
 */
export function unwrapPullResponseEnvelope(envelope, secretKeySeed) {
	const json = decryptUtf8ForMember(envelope, secretKeySeed)
	if (!json) return null
	try {
		return JSON.parse(json)
	}
	catch {
		return null
	}
}
