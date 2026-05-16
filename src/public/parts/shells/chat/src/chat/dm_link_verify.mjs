import { Buffer } from 'node:buffer'

import { verify } from '../../../../../../scripts/p2p/crypto.mjs'

/** 与 `public/src/dmLink.mjs` 中 `DM_LINK_SIG_PREFIX` 一致。 */
const DM_LINK_SIG_PREFIX = 'fount-dm-link-v1'

/**
 * @param {string} hex Ed25519 公钥 hex
 * @returns {string} 小写无 0x
 */
export function normalizePubKeyHex64(hex) {
	return String(hex || '').trim().toLowerCase().replace(/^0x/iu, '')
}

/**
 * 供 Ed25519 验签的字节：`fount-dm-link-v1|hex64pub|nonceBase64Url` UTF-8
 *
 * @param {string} pubKeyHex64 64 hex 字符
 * @param {string} nonceBase64Url nonce
 * @returns {Uint8Array} 消息字节
 */
export function dmLinkSignableBytes(pubKeyHex64, nonceBase64Url) {
	const pk = normalizePubKeyHex64(pubKeyHex64)
	const n = String(nonceBase64Url || '')
	return new TextEncoder().encode(`${DM_LINK_SIG_PREFIX}|${pk}|${n}`)
}

/**
 * 校验「介绍方」对 DM Link nonce 的自证签名（§16）。
 *
 * @param {string} introPubKeyHex 介绍者公钥 hex（须与会话 `peerPubKeyHex` 一致）
 * @param {string} nonceBase64Url 链接明文中的 nonce（base64url）
 * @param {string} sigHex128 Ed25519 签名 hex（128 字符）
 * @returns {Promise<boolean>} 验签是否通过
 */
export async function verifyDmLinkSignature(introPubKeyHex, nonceBase64Url, sigHex128) {
	const pkHex = normalizePubKeyHex64(introPubKeyHex)
	const sigHex = String(sigHex128 || '').trim().replace(/^0x/iu, '')
	if (!/^[0-9a-f]{64}$/iu.test(pkHex) || !/^[0-9a-f]{128}$/iu.test(sigHex)) return false
	const sig = Buffer.from(sigHex, 'hex')
	const pub = Buffer.from(pkHex, 'hex')
	const msg = dmLinkSignableBytes(pkHex, nonceBase64Url)
	return verify(new Uint8Array(sig), new Uint8Array(msg), new Uint8Array(pub))
}
