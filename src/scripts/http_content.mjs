/**
 * 同源文件下发安全头：nosniff；仅白名单 MIME 可 inline，其余强制 attachment + octet-stream。
 * 防止对端自报 text/html / image/svg+xml 在带 Cookie 的页面里执行。
 */

/** 允许浏览器直接渲染（img/video/audio）的 MIME（不含 svg/html/xml）。 */
export const INLINE_SAFE_MIME_TYPES = new Set([
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/gif',
	'image/webp',
	'image/avif',
	'image/bmp',
	'audio/mpeg',
	'audio/mp3',
	'audio/ogg',
	'audio/webm',
	'audio/wav',
	'audio/flac',
	'audio/aac',
	'video/mp4',
	'video/webm',
	'video/ogg',
])

/**
 * @param {string | null | undefined} mimeType 声明 MIME
 * @returns {string} 规范化 type/subtype（小写，无参数）
 */
export function normalizeMimeType(mimeType) {
	return String(mimeType || '').split(';')[0].trim().toLowerCase()
}

/**
 * @param {string | null | undefined} mimeType 声明 MIME
 * @returns {boolean} 是否允许 inline
 */
export function isInlineSafeMimeType(mimeType) {
	return INLINE_SAFE_MIME_TYPES.has(normalizeMimeType(mimeType))
}

/**
 * 写入 Content-Type / nosniff /（必要时）Content-Disposition。
 * @param {import('npm:express').Response} res Express 响应
 * @param {{ mimeType?: string | null, filename?: string | null, forceAttachment?: boolean }} [options] 选项
 * @returns {{ contentType: string, inline: boolean }} 实际下发类型
 */
export function applySafeContentHeaders(res, options = {}) {
	res.setHeader('X-Content-Type-Options', 'nosniff')
	const declared = normalizeMimeType(options.mimeType)
	const inline = !options.forceAttachment && isInlineSafeMimeType(declared)
	if (inline) {
		res.setHeader('Content-Type', declared)
		return { contentType: declared, inline: true }
	}
	res.setHeader('Content-Type', 'application/octet-stream')
	const name = String(options.filename || 'download').replace(/["\r\n]/g, '') || 'download'
	res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
	return { contentType: 'application/octet-stream', inline: false }
}
