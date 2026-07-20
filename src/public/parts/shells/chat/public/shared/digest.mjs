/**
 * @param {Uint8Array|ArrayBufferView|Iterable<number>} bytes 字节
 * @returns {string} 小写 hex
 */
export function bytesToHex(bytes) {
	return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * @param {string} hex 十六进制（可含空白）
 * @returns {Uint8Array} 字节
 */
export function hexToBytes(hex) {
	const clean = String(hex || '').replace(/\s/g, '')
	const out = new Uint8Array(clean.length / 2)
	for (let i = 0; i < out.length; i++)
		out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
	return out
}

const SHA256 = await (async () => {
	if (globalThis.document) {
		const { sha256 } = await import('https://esm.sh/@noble/hashes/sha2.js')
		return sha256
	}
	const { createHash } = await import('node:crypto')
	return {
		/**
		 * @returns {{ update: (chunk: Uint8Array) => void, digest: () => Uint8Array }} 增量 SHA-256 上下文
		 */
		create() {
			const hash = createHash('sha256')
			return {
				/**
				 * @param {Uint8Array|ArrayBufferView} chunk 待哈希字节块
				 * @returns {void}
				 */
				update(chunk) {
					hash.update(chunk)
				},
				/**
				 * @returns {Uint8Array} 最终摘要
				 */
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
