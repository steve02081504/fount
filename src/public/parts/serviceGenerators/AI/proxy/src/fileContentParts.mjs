/**
 * 附件 → OpenAI contentParts（image_url / input_audio）的纯构建逻辑。
 * 不依赖 prompt_struct 图，供 messageBuilder 与纯测试共用。
 */
import { Buffer } from 'node:buffer'

/**
 * 剥离 MIME 参数（`image/png; charset=utf-8` → `image/png`）。
 * @param {string} mimeType 原始 MIME
 * @returns {string} 基础 MIME
 */
export function mimeTypeBase(mimeType) {
	return String(mimeType || '').split(';')[0].trim()
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
 * @returns {Promise<{ parts: object[], skipped: string[] }>} contentParts 与跳过名单
 */
export async function buildFileContentParts(files, textContent) {
	const parts = [{ type: 'text', text: textContent }]
	const skipped = []
	for (const file of files) {
		const rawMime = file.mime_type || ''
		if (!rawMime) continue
		const mime = mimeTypeBase(rawMime)
		const bytes = await resolveFileBuffer(file)
		if (!bytes) {
			skipped.push(file.name || 'unknown')
			continue
		}
		if (mime.startsWith('image/'))
			parts.push({
				type: 'image_url',
				image_url: {
					url: `data:${mime};base64,${bytes.toString('base64')}`,
				},
			})
		else if (mime.startsWith('audio/')) {
			const formatMap = {
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
			const format = formatMap[mime.toLowerCase()] || 'wav'
			parts.push({
				type: 'input_audio',
				input_audio: {
					data: bytes.toString('base64'),
					format,
				},
			})
		}
	}
	return { parts, skipped }
}
