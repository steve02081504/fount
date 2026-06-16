/**
 * 【文件】public/src/lib/dmLinkSignature.mjs
 * 【职责】§16 DM Link 验签域：可签名 UTF-8 字节串构造。
 * 【原理】dmLinkSignableBytes = prefix|pubKeyHex64|nonceBase64Url；DM_LINK_SIGNATURE_PREFIX 常量。
 * 【数据结构】pubKeyHex64、nonceBase64Url、Uint8Array signable。
 * 【关联】dmLink.mjs、signer.mjs；后端 DM 建群验签。
 */
import { normalizePubKeyHex } from './pubKeyHex.mjs'

/** §16 DM Link 验签域前缀。 */
export const DM_LINK_SIGNATURE_PREFIX = 'fount-dm-link'

/**
 * DM Link 验签消息：`fount-dm-link|<pubKeyHex64>|<nonceBase64Url>` UTF-8
 *
 * @param {string} pubKeyHex64 64 hex 介绍者公钥
 * @param {string} nonceBase64Url nonce
 * @returns {Uint8Array} 验签消息字节
 */
export function dmLinkSignableBytes(pubKeyHex64, nonceBase64Url) {
	const pubKey = normalizePubKeyHex(pubKeyHex64)
	return new TextEncoder().encode(`${DM_LINK_SIGNATURE_PREFIX}|${pubKey}|${nonceBase64Url}`)
}
