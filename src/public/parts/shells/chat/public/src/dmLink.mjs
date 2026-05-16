/** §16 DM Link：首次建联手序；签名域与 `chat/src/chat/dm_link_verify.mjs` 对齐。 */

/** DM Link 规格版本标识 */
export const DM_LINK_VER = '1'
/** 与验签前缀字符串一致（须与服务端 dm_link_verify 同步） */
export const DM_LINK_SIG_PREFIX = 'fount-dm-link-v1'

const LS_KEY_DM_NONCE = 'fount.chat.dmIntroNonce'

/**
 * @param {ArrayBufferLike} buf 二进制缓冲
 * @returns {string} URL-safe Base64（无填充）
 */
export function toBase64Url(buf) {
	const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
	return b64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/**
 * @param {string} s base64url
 * @returns {Uint8Array} 解码后的原始字节
 */
export function fromBase64Url(s) {
	const pad = '='.repeat((4 - (s.length % 4)) % 4)
	const str = String(s || '').replaceAll('-', '+').replaceAll('_', '/') + pad
	const bin = atob(str)
	const out = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
	return out
}

/**
 * @param {string} hex 公钥 hex
 * @returns {string} 小写 64 hex
 */
export function normalizeDmLinkPubHex(hex) {
	return String(hex || '').trim().toLowerCase().replace(/^0x/iu, '')
}

/**
 * 生成 DM Link 所用 UTF-8 验签前缀正文（须在 Ed25519 下签名）。
 *
 * @param {string} pubKeyHex64 介绍者 Ed25519 公钥 hex
 * @param {string} nonceBase64Url 随机 nonce
 * @returns {Uint8Array} 消息字节
 */
export function buildDmLinkSignableBytes(pubKeyHex64, nonceBase64Url) {
	const pk = normalizeDmLinkPubHex(pubKeyHex64)
	return new TextEncoder().encode(`${DM_LINK_SIG_PREFIX}|${pk}|${nonceBase64Url}`)
}

/**
 * 随机 32-byte nonce → base64url；默认写入 localStorage。
 *
 * @param {{ persist?: boolean }} [opts] persist 默认 true
 * @returns {string} nonce
 */
export function rotateDmLink({ persist = true } = {}) {
	const n = new Uint8Array(32)
	crypto.getRandomValues(n)
	const s = toBase64Url(n.buffer)
	try {
		if (persist && typeof localStorage !== 'undefined')
			localStorage.setItem(LS_KEY_DM_NONCE, s)

	}
	catch { /* 隐私模式等 */ }

	return s
}

/**
 * 读取当前可用的 DM Link nonce；无则自动生成。
 *
 * @returns {string} nonce base64url
 */
export function getDmLinkNonce() {
	try {
		if (typeof localStorage !== 'undefined') {
			const x = localStorage.getItem(LS_KEY_DM_NONCE)
			if (x && typeof x === 'string' && x.length >= 16) return x
		}
	}
	catch { /* empty */ }

	return rotateDmLink({ persist: true })
}

/**
 * 组装 `fount://dm` 样式链接（或对端可复制 query 串）。
 *
 * @param {object} p 参数
 * @param {string} p.pubKeyHex 介绍者公钥 hex
 * @param {string} p.nonceBase64Url nonce
 * @param {string} [p.sigHex] 128 hex 签名
 * @param {string} [p.node] 可选节点 URL
 * @param {string} [p.ver] 版本，默认 `'1'`
 * @returns {string} URI
 */
export function formatDmLinkUrl({ pubKeyHex, nonceBase64Url, sigHex, node, ver = DM_LINK_VER }) {
	const pk = normalizeDmLinkPubHex(pubKeyHex)
	const q = new URLSearchParams()
	q.set('pubkey', pk)
	q.set('nonce', nonceBase64Url)
	if (sigHex) q.set('sig', String(sigHex).trim().replace(/^0x/iu, ''))
	if (node) q.set('node', node)
	q.set('ver', ver || DM_LINK_VER)
	return `fount://dm?${q.toString()}`
}

/**
 * 用浏览器侧私钥签发介绍链接并返回 URI（须由调用方传入 `sign`）。
 *
 * @param {object} p 参数
 * @param {string} p.pubKeyHex 本人公钥 hex
 * @param {Uint8Array|ArrayBuffer} p.secretKey32 Ed25519 私钥种子 32 字节
 * @param {(msg: Uint8Array, sk: Uint8Array) => Promise<Uint8Array>} p.signFn 通常为 `@noble/ed25519.sign`
 * @param {string} [p.nodeUrl] 可选
 * @param {string} [p.nonce] 不传则用 `getDmLinkNonce()`
 * @returns {Promise<string>} `fount://dm?...` 完整 URI
 */
export async function createDmLink({ pubKeyHex, secretKey32, signFn, nodeUrl, nonce }) {
	const pk = normalizeDmLinkPubHex(pubKeyHex)
	if (!/^[0-9a-f]{64}$/iu.test(pk)) throw new Error('invalid pubKeyHex')

	const nonceBase64Url = nonce || getDmLinkNonce()
	const sk = secretKey32 instanceof Uint8Array
		? secretKey32
		: new Uint8Array(/** @type {ArrayBuffer} */ secretKey32)
	const msg = buildDmLinkSignableBytes(pk, nonceBase64Url)
	const sig = await signFn(msg, sk)
	if (!(sig instanceof Uint8Array) || sig.length !== 64) throw new Error('invalid signature length')

	const sigHex = [...sig].map(b => b.toString(16).padStart(2, '0')).join('')
	return formatDmLinkUrl({ pubKeyHex: pk, nonceBase64Url, sigHex, node: nodeUrl })
}
