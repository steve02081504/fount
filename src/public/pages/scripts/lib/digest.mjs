/**
 * @param {Uint8Array|ArrayBufferView} bytes 字节
 * @returns {string} 小写 hex
 */
function bytesToHex(bytes) {
	return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

const SHA256 = await (async () => {
	if (globalThis.document) {
		const { sha256 } = await import('https://esm.sh/@noble/hashes/sha2.js')
		return sha256
	}
	const { createHash } = await import('node:crypto')
	return {
		create() {
			const hash = createHash('sha256')
			return {
				update(chunk) {
					hash.update(chunk)
				},
				digest() {
					return new Uint8Array(hash.digest())
				},
			}
		},
	}
})()

/**
 * @param {ArrayBuffer|ArrayBufferView} data 字节输入
 * @returns {Promise<string>} 小写 hex SHA-256
 */
export async function sha256Hex(data) {
	const hasher = SHA256.create()
	const input = data instanceof ArrayBuffer
		? new Uint8Array(data)
		: new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
	hasher.update(input)
	return bytesToHex(hasher.digest())
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
	const hasher = SHA256.create()
	for (let offset = 0; offset < blob.size; offset += chunkSize) {
		const slice = blob.slice(offset, Math.min(offset + chunkSize, blob.size))
		hasher.update(new Uint8Array(await slice.arrayBuffer()))
	}
	return bytesToHex(hasher.digest())
}
