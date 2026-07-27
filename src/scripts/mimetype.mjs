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
 * 仅魔数嗅探（不回退文件名）。
 * @param {ArrayBuffer | Uint8Array | Buffer} buffer 文件内容
 * @returns {Promise<string | null>} MIME；无法识别时 null
 */
export async function sniffMimeFromBuffer(buffer) {
	if (!buffer) return null
	const bytes = toUint8Array(buffer)
	if (!bytes.length) return null
	return (await fileTypeFromBuffer(bytes))?.mime ?? null
}

/**
 * @param {string} name 文件名
 * @returns {string | null} 由扩展名推断的 MIME
 */
export function mimeFromFilename(name) {
	return mimetype.lookup(name) || null
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

/**
 * @param {string} type MIME 类型
 * @returns {string | null} 扩展名（不含点）；未知时为 null
 */
export function getFileExtFromMimetype(type) {
	return mimetype.extension(type) || null
}

/**
 * 从文件头与文件名推断 MIME 与扩展名（用于修正 `application/octet-stream` 等）。
 * @param {ArrayBuffer | Uint8Array | Buffer} bytes 文件头或完整内容
 * @param {string} [name] 文件名
 * @returns {Promise<{ mime: string, ext: string } | null>} 可识别时返回；否则 null
 */
export async function mimeAndExtFromBuffer(bytes, name = '') {
	const mimeType = await mimetypeFromBufferAndName(bytes, name)
	if (mimeType === 'application/octet-stream') return null
	const ext = getFileExtFromMimetype(mimeType)
	if (!ext) return null
	return { mime: mimeType, ext }
}
