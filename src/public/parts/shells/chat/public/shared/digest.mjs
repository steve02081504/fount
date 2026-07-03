/**
 * @param {Uint8Array|ArrayBufferView} bytes 字节
 * @returns {string} 小写 hex
 */
function bytesToHex(bytes) {
	return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * @param {ArrayBuffer|ArrayBufferView} data 字节输入
 * @returns {Promise<string>} 小写 hex SHA-256
 */
export async function sha256Hex(data) {
	const input = data instanceof ArrayBuffer
		? data
		: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
	return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', input)))
}

/**
 * @param {string} text UTF-8 文本
 * @returns {Promise<string>} 小写 hex SHA-256
 */
export async function sha256TextHex(text) {
	return sha256Hex(new TextEncoder().encode(String(text ?? '')))
}
