import { fileTypeFromBuffer } from 'https://esm.sh/file-type'
import mimetype from 'https://esm.sh/mime-types'

/**
 * @param {ArrayBuffer | Uint8Array | Buffer} buffer 文件内容
 * @returns {Uint8Array} 统一为 Uint8Array 的视图
 */
function toUint8Array(buffer) {
	if (buffer instanceof Uint8Array) return buffer
	return new Uint8Array(buffer)
}

/**
 * @param {ArrayBuffer | Uint8Array | Buffer} buffer 文件内容
 * @param {string} [name] 文件名
 * @returns {Promise<string>} MIME 类型
 */
export async function mimetypeFromBufferAndName(buffer, name = '') {
	const bytes = toUint8Array(buffer)
	let result = (await fileTypeFromBuffer(bytes))?.mime
	result ||= mimetype.lookup(name)
	if (!result) {
		const sample = bytes.subarray(0, Math.min(bytes.length, 4096))
		try {
			new TextDecoder('utf-8', { fatal: true }).decode(sample)
			result = 'text/plain'
		} catch { /* binary */ }
	}
	return result || 'application/octet-stream'
}
