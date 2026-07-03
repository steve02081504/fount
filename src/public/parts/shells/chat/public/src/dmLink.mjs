/**
 * 【文件】public/src/dmLink.mjs
 * 【职责】§16 DM Link：nonce 轮换、Ed25519 签名与 formatDmRunUri 分享链接。
 * 【原理】dmLinkSignableBytes 构造验签域；rotateDmLink 更新联邦设置中的 nonce；sign(signer.mjs) 产出 intro 签名。
 * 【数据结构】pubKeyHex64、nonceBase64Url、introSignatureHex；persist 选项。
 * 【关联】lib/dmLinkSignature.mjs、groupApi、runUri.mjs、signer.mjs。
 */

import { normalizePubKeyHex, PUB_KEY_HEX_64 } from '../shared/pubKeyHex.mjs'
import { formatDmRunUri } from '../shared/runUri.mjs'

import { putFederationSettings } from './api/groupApi.mjs'
import { dmLinkSignableBytes } from './lib/dmLinkSignature.mjs'
import { sign } from './lib/signer.mjs'


const LS_KEY_DM_NONCE = 'fount.chat.dmIntroNonce'

/**
 * @param {ArrayBufferLike} buffer 二进制缓冲
 * @returns {string} URL-safe Base64（无填充）
 */
export function toBase64Url(buffer) {
	const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
	return base64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/**
 * @param {string} base64url base64url
 * @returns {Uint8Array} 解码后的原始字节
 */
export function fromBase64Url(base64url) {
	const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
	const base64 = String(base64url || '').replaceAll('-', '+').replaceAll('_', '/') + pad
	const binary = atob(base64)
	const bytes = new Uint8Array(binary.length)
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
	return bytes
}

/**
 * 随机 32-byte nonce → base64url；默认写入 localStorage。
 * @param {{ persist?: boolean }} [options] persist 默认 true
 * @returns {string} nonce
 */
export function rotateDmLink({ persist = true } = {}) {
	const bytes = new Uint8Array(32)
	crypto.getRandomValues(bytes)
	const nonce = toBase64Url(bytes.buffer)
	if (persist) localStorage.setItem(LS_KEY_DM_NONCE, nonce)
	return nonce
}

/**
 * 读取当前可用的 DM Link nonce；无则自动生成。
 * @returns {string} nonce base64url
 */
export function getDmLinkNonce() {
	const stored = localStorage.getItem(LS_KEY_DM_NONCE)
	if (stored && stored.length >= 16) return stored
	return rotateDmLink({ persist: true })
}

/**
 * @param {object} options 参数
 * @param {string} options.pubKeyHex 介绍者公钥 hex
 * @param {string} options.nonceBase64Url nonce
 * @param {string} [options.introSignatureHex] 128 hex 签名
 * @param {string} [options.node] 可选节点 URL
 * @returns {string} URI
 */
export function formatDmLinkUrl({ pubKeyHex, nonceBase64Url, introSignatureHex, node }) {
	return formatDmRunUri({
		pubKeyHex,
		nonceBase64Url,
		introSignatureHex,
		nodeUrl: node,
	})
}

/**
 * 将当前有效 nonce 同步到本节点 shellData（经 `PUT /api/p2p/federation` 的 `dmIntroNonce` 字段）。
 * @param {string} nonce base64url
 * @returns {Promise<void>}
 */
export async function syncDmIntroNonceToNode(nonce) {
	const normalized = String(nonce || '').trim()
	if (normalized.length < 16) throw new Error('dmIntro nonce too short')
	await putFederationSettings({ dmIntroNonce: normalized })
}

/**
 * 客户端轮换 nonce 并同步到 Deno（§16）。
 * @param {{ persist?: boolean }} [options] 同 `rotateDmLink`
 * @returns {Promise<string>} 新 nonce
 */
export async function rotateDmLinkAndSync(options = {}) {
	const nonce = rotateDmLink(options)
	await syncDmIntroNonceToNode(nonce)
	return nonce
}

/**
 * 签发 DM Link 并同步 nonce 到本节点（Hub 包装层入口）。
 * @param {object} options 同 `createDmLink`，`signFn` 可省略
 * @returns {Promise<string>} `fount://run/…/dm;…`
 */
export async function createDmLinkAndSync(options) {
	const pubKey = normalizePubKeyHex(options.pubKeyHex)
	const nonce = options.nonce || getDmLinkNonce()
	const signFn = options.signFn || sign
	const url = await createDmLink({ ...options, nonce, signFn })
	await syncDmIntroNonceToNode(nonce)
	return url
}

/**
 * 用浏览器侧私钥签发介绍链接并返回 URI（须由调用方传入 `sign`）。
 *
 * @param {object} options 参数
 * @param {string} options.pubKeyHex 本人公钥 hex
 * @param {Uint8Array|ArrayBuffer} options.secretKey32 私钥种子 32 字节
 * @param {(signableBytes: Uint8Array, secretKey: Uint8Array) => Promise<Uint8Array>} options.signFn 默认 `./lib/signer.mjs` 的 `sign`
 * @param {string} [options.nodeUrl] 可选
 * @param {string} [options.nonce] 不传则用 `getDmLinkNonce()`
 * @returns {Promise<string>} canonical run URI
 */
export async function createDmLink({ pubKeyHex, secretKey32, signFn, nodeUrl, nonce }) {
	const pubKey = normalizePubKeyHex(pubKeyHex)
	if (!PUB_KEY_HEX_64.test(pubKey)) throw new Error('invalid pubKeyHex')

	const nonceBase64Url = nonce || getDmLinkNonce()
	const secretKey = secretKey32 instanceof Uint8Array
		? secretKey32
		: new Uint8Array(/** @type {ArrayBuffer} */ secretKey32)
	const signatureBytes = await signFn(dmLinkSignableBytes(pubKey, nonceBase64Url), secretKey)
	if (!(signatureBytes instanceof Uint8Array) || signatureBytes.length !== 64) throw new Error('invalid signature length')

	const introSignatureHex = [...signatureBytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
	return formatDmLinkUrl({ pubKeyHex: pubKey, nonceBase64Url, introSignatureHex, node: nodeUrl })
}
