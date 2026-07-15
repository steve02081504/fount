import { normalizeHex64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'
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
