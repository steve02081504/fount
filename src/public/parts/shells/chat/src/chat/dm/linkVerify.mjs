/**
 * 【文件】dm/linkVerify.mjs
 * 【职责】校验介绍方对 DM Link nonce 的 Ed25519 自证签名（§16）。
 * 【原理】dmLinkSignableBytes 构造验签域；p2p/crypto verify 比对 128 hex 签名与 64 hex 公钥。
 * 【数据结构】入参 introPubKeyHex、nonceBase64Url、introSignatureHex；返回 boolean。
 * 【关联】dm/linkValidate、lib/dmLinkSignature；无持久化状态。
 */
import { Buffer } from 'node:buffer'

import { verify } from '../../../../../../../scripts/p2p/crypto.mjs'
import { HEX_ID_64 as PUB_KEY_HEX_64, normalizeHex64 as normalizePubKeyHex } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { dmLinkSignableBytes } from '../../../public/shared/dmLinkSignature.mjs'

/**
 * 校验「介绍方」对 DM Link nonce 的自证签名（§16）。
 *
 * @param {string} introPubKeyHex 介绍者公钥 hex
 * @param {string} nonceBase64Url 链接明文中的 nonce（base64url）
 * @param {string} introSignatureHex 签名 hex（128 字符）
 * @returns {Promise<boolean>} 验签是否通过
 */
export async function verifyDmLinkSignature(introPubKeyHex, nonceBase64Url, introSignatureHex) {
	const pubKeyHex = normalizePubKeyHex(introPubKeyHex)
	const signatureHex = String(introSignatureHex || '').trim().replace(/^0x/iu, '')
	if (!PUB_KEY_HEX_64.test(pubKeyHex) || !/^[\da-f]{128}$/iu.test(signatureHex)) return false
	return verify(
		new Uint8Array(Buffer.from(signatureHex, 'hex')),
		dmLinkSignableBytes(pubKeyHex, nonceBase64Url),
		new Uint8Array(Buffer.from(pubKeyHex, 'hex')),
	)
}
