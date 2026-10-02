/**
 * 附件 → OpenAI contentParts（image_url / input_audio）的纯构建逻辑。
 * 不依赖 prompt_struct 图，供 messageBuilder 与纯测试共用。
 */
import { Buffer } from 'node:buffer'

import { convertAttachment, mimeTypeBase } from './attachmentConversion.mjs'

/** OpenAI `input_audio.format` 支持的 MIME 映射。 */
const AUDIO_FORMATS = {
	'audio/wav': 'wav',
	'audio/wave': 'wav',
	'audio/x-wav': 'wav',
	'audio/mpeg': 'mp3',
	'audio/mp3': 'mp3',
	'audio/mp4': 'mp4',
	'audio/m4a': 'm4a',
	'audio/webm': 'webm',
	'audio/ogg': 'ogg',
}

/**
 * 附件基础 MIME；缺失时回退 `application/octet-stream`。
 * @param {object} file 附件描述符
 * @returns {string} 基础 MIME
 */
export function fileMimeType(file) {
	return mimeTypeBase(file.mime_type) || 'application/octet-stream'
}

/**
 * 附件是否命中任一 MIME 正则。
 * 正则非法时按未命中处理，避免一条坏配置丢掉全部附件。
 * @param {string[]} patterns MIME 正则列表
 * @param {object} file 附件描述符
 * @returns {boolean} 是否命中
 */
export function matchesMimePatterns(patterns, file) {
	if (!Array.isArray(patterns) || !patterns.length) return false
	const mime = fileMimeType(file)
	return patterns.some(pattern => {
		try {
			return new RegExp(pattern, 'i').test(mime)
		}
		catch {
			return false
		}
	})
}

/**
 * 解析附件字节（优先异步 getBuffer；缺省回退同步 buffer）。
 * 空字节 / 加载失败返回 null——调用方须跳过，不得发空 base64 data URL。
 * @param {object} file 附件描述符
 * @returns {Promise<Buffer | null>} 字节或 null（不可用）
 */
export async function resolveFileBuffer(file) {
	if (typeof file.getBuffer === 'function')
		try {
			const bytes = await file.getBuffer()
			return Buffer.isBuffer(bytes) && bytes.length ? bytes : null
		}
		catch {
			return null
		}
	const buffer = file.buffer
	if (Buffer.isBuffer(buffer) && buffer.length) return buffer
	return null
}

/**
 * 构建附件 contentParts（image_url / input_audio），空字节或加载失败的文件跳过并计入 skipped。
 * @param {object[]} files 附件描述符
 * @param {string} textContent 正文
 * @param {{ binaryMode?: 'base64' | 'buffer', allowedMimeTypes?: string[] | null }} [options] 快照模式与允许的 MIME 列表；null/缺省保持原样，空列表拒绝全部。
 * @returns {Promise<{ parts: object[], skipped: string[], notices: string[] }>} contentParts、不可用附件与不支持格式提示。
 */
export async function buildFileContentParts(files, textContent, options = {}) {
	const { binaryMode = 'base64', allowedMimeTypes = null } = options
	const parts = [{ type: 'text', text: textContent }]
	const skipped = []
	const notices = []
	/**
	 * 记录一条无法以本请求格式呈现的附件提示。
	 * @param {object} file 附件描述符
	 * @param {string} mime 实际 MIME
	 * @returns {void}
	 */
	const unsupported = (file, mime) => notices.push(`[System Notice: can't show you about file '${file.name || 'unknown'}' with type '${mime}' because this request format cannot represent its content.]`)
	for (const file of files) {
		const rawMime = file.mime_type || ''
		if (!rawMime && allowedMimeTypes == null) continue
		const mime = mimeTypeBase(rawMime) || 'application/octet-stream'
		const bytes = await resolveFileBuffer(file)
		if (!bytes) {
			skipped.push(file.name || 'unknown')
			continue
		}
		const converted = await convertAttachment(bytes, mime, allowedMimeTypes)
		if (!converted) {
			unsupported(file, mime)
			continue
		}
		const { bytes: convertedBytes, mime: convertedMime } = converted
		if (convertedMime.startsWith('image/'))
			parts.push({
				type: 'image_url',
				image_url: binaryMode === 'buffer'
					? { mime_type: convertedMime, data: convertedBytes }
					: { url: `data:${convertedMime};base64,${convertedBytes.toString('base64')}` },
			})
		else if (convertedMime.startsWith('audio/')) {
			const format = AUDIO_FORMATS[convertedMime]
			if (!format && allowedMimeTypes != null) {
				unsupported(file, convertedMime)
				continue
			}
			parts.push({
				type: 'input_audio',
				input_audio: binaryMode === 'buffer'
					? { mime_type: convertedMime, format: format || 'wav', data: convertedBytes }
					: { data: convertedBytes.toString('base64'), format: format || 'wav' },
			})
		}
		else if (allowedMimeTypes != null) {
			if (convertedMime.startsWith('text/'))
				try {
					parts.push({ type: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(convertedBytes) })
					continue
				}
				catch { /* 非法文本在下方记入提示。 */ }
			unsupported(file, convertedMime)
		}
	}
	return { parts, skipped, notices }
}
