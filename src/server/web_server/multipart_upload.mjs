/**
 * Express fileupload 解析后的 multipart 辅助（服务端唯一实现）。
 */
import { Buffer } from 'node:buffer'

import { mimeFromFilename, sniffMimeFromBuffer } from '../../scripts/mimetype.mjs'

/**
 * 从 express-fileupload 填充的 `req.files` 取单字段文件（fount 全局中间件已解析 multipart）。
 * @param {import('npm:express').Request} req HTTP 请求
 * @param {string} field 表单字段名
 * @returns {{ buffer: Buffer, originalname: string, mimetype: string } | null} 文件对象
 */
export function pickUploadedFile(req, field) {
	const raw = req.files?.[field]
	if (!raw) return null
	const file = Array.isArray(raw) ? raw[0] : raw
	if (!file?.data) return null
	return {
		buffer: Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data),
		originalname: file.name || 'upload',
		mimetype: file.mimetype || 'application/octet-stream',
	}
}

/**
 * 扩展名、声明 Content-Type、魔数三者一致，且为 `image/*`（含 SVG）。
 * @param {{ buffer: Buffer, originalname: string, mimetype: string }} file 上传文件
 * @returns {Promise<boolean>} 是否为图片上传
 */
export async function isAllowedImageUpload(file) {
	if (!file?.buffer?.length) return false
	const fromExt = mimeFromFilename(file.originalname)
	const declared = String(file.mimetype || '').toLowerCase().split(';')[0].trim()
	if (!fromExt?.startsWith('image/') || declared !== fromExt) return false
	const sniffed = await sniffMimeFromBuffer(file.buffer)
	// SVG 等 XML 图魔数常空：扩展名与声明已对齐时放行
	if (!sniffed) return fromExt === 'image/svg+xml'
	return sniffed === fromExt
}
