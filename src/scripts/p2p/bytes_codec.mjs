/**
 * Base64 / hex / bytes 互转（无 Node 依赖，浏览器与 Node 共用）。
 */

/**
 * @param {ArrayBuffer} buffer 原始二进制缓冲
 * @returns {string} 标准 Base64 文本
 */
export function arrayBufferToBase64(buffer) {
	let binary = ''
	const bytes = new Uint8Array(buffer)
	for (let i = 0; i < bytes.byteLength; i++)
		binary += String.fromCharCode(bytes[i])
	return btoa(binary)
}

/**
 * @param {Uint8Array} u8 原始字节
 * @returns {string} 标准 Base64 文本
 */
export function u8ToB64(u8) {
	let s = ''
	for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
	return btoa(s)
}

/**
 * @param {string} b64 标准 Base64 文本
 * @returns {Uint8Array} 解码后的字节
 */
export function b64ToU8(b64) {
	const bin = atob(b64)
	const out = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
	return out
}

/**
 * @param {string} hex 十六进制文本（可带 0x 前缀，长度须为 2×nBytes）
 * @param {number} nBytes 目标字节数
 * @returns {Uint8Array} 解析得到的字节数组
 */
export function hexToNBytes(hex, nBytes) {
	const t = String(hex).replace(/^0x/iu, '').trim()
	if (t.length !== nBytes * 2 || !/^[0-9a-f]+$/iu.test(t))
		throw new RangeError('invalid hex length or characters')
	const out = new Uint8Array(nBytes)
	for (let i = 0; i < nBytes; i++)
		out[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16)
	return out
}
