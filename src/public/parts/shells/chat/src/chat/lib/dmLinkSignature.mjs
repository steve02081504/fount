/**
 * 【文件】src/chat/lib/dmLinkSignature.mjs
 * 【职责】DM 深链签名编解码：服务端与前端共用的 payload 签名格式。
 * 【原理】canonical JSON + Ed25519；与 public/src/lib/dmLinkSignature 对齐。
 * 【数据结构】SignedDmLink：payloadB64、sigHex、pubKey。
 * 【关联】dm/linkVerify、dm/linkValidate、public deepLinkConsume。
 */
import { normalizeHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'

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
	const pubKey = normalizeHex64(pubKeyHex64)
	return new TextEncoder().encode(`${DM_LINK_SIGNATURE_PREFIX}|${pubKey}|${nonceBase64Url}`)
}
