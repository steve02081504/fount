import { fileTypeFromBuffer } from 'https://esm.sh/file-type'
import mime from 'https://esm.sh/mime'
import mimetype from 'https://esm.sh/mime-types'

/**
 * 将多种缓冲区类型统一转换为 Uint8Array。
 * @param {ArrayBuffer | Uint8Array | Buffer} buffer 文件内容（或前 N 字节）
 * @returns {Uint8Array} 统一为 Uint8Array 视图
 */
function toUint8Array(buffer) {
	if (buffer instanceof Uint8Array) return buffer
	return new Uint8Array(buffer)
}

/**
 * 根据文件内容与文件名推断 MIME 类型（魔数优先，扩展名次之）。
 * @param {ArrayBuffer | Uint8Array | Buffer} buffer 文件内容（或前 N 字节）
 * @param {string} [name] 文件名
 * @returns {Promise<string>} 推断出的 MIME 类型
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
 * 根据 MIME 类型获取文件扩展名（不含点）。
 * @param {string} type MIME 类型
 * @returns {string | null} 扩展名；未知时为 null
 */
export function getFileExtFromMimetype(type) {
	return mime.getExtension(type)
}

/**
 * 从文件头与文件名推断 MIME 与扩展名（用于修正 `application/octet-stream` 等）。
 * @param {ArrayBuffer | Uint8Array} bytes 文件头或完整内容
 * @param {string} [name] 文件名
 * @returns {Promise<{ mime: string, ext: string } | null>} 可识别时返回；否则 null
 */
export async function mimeAndExtFromBuffer(bytes, name = '') {
	const mimeType = await mimetypeFromBufferAndName(bytes, name)
	if (mimeType === 'application/octet-stream') return null
	const ext = getFileExtFromMimetype(mimeType) || mimetype.extension(mimeType)
	if (!ext) return null
	return { mime: mimeType, ext }
}
