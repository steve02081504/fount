/**
 * @param {ArrayBuffer|ArrayBufferView} data 字节输入
 * @returns {Promise<string>} 小写 hex SHA-256
 */
export async function sha256Hex(data) {
	const input = data instanceof ArrayBuffer
		? data
		: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
	const digest = await crypto.subtle.digest('SHA-256', input)
	return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * @param {string} text UTF-8 文本
 * @returns {Promise<string>} 小写 hex SHA-256
 */
export async function sha256TextHex(text) {
	return sha256Hex(new TextEncoder().encode(String(text ?? '')))
}

/**
 * 分片读取 Blob/File，避免整文件进内存。
 * @param {Blob} blob 文件
 * @param {number} [chunkSize=4 * 1024 * 1024] 分片大小
 * @returns {Promise<string>} 小写 hex SHA-256
 */
export async function sha256HexFromBlob(blob, chunkSize = 4 * 1024 * 1024) {
	const { sha256 } = await import('https://esm.sh/@noble/hashes@1.7.1/sha256.js')
	const hasher = sha256.create()
	for (let offset = 0; offset < blob.size; offset += chunkSize) {
		const slice = blob.slice(offset, Math.min(offset + chunkSize, blob.size))
		hasher.update(new Uint8Array(await slice.arrayBuffer()))
	}
	return [...hasher.digest()].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
