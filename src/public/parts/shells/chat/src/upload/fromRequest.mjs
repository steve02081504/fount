/**
 * 【文件】src/upload/fromRequest.mjs
 * 【职责】从 Express 全局 fileupload 中间件解析后的 req.files 中取出单字段上传，并校验图片 MIME/扩展名/魔数。
 * 【原理】fount 已在 HTTP 层统一 multipart 解析，路由只需 pickUploadedFile(req, field) 得到 buffer 三元组；
 *   isAllowedImageUpload 要求 extname、声明 mimetype 与 file-type 嗅探三者一致。
 * 【数据结构】返回 { buffer, originalname, mimetype } | null；无文件或缺 data 时 null。
 * 【关联】群表情、附件上传等路由使用；不自行解析 multipart。
 */
import { Buffer } from 'node:buffer'
import path from 'node:path'

import { fileTypeFromBuffer } from 'https://esm.sh/file-type@19.6.0'

/** @type {Set<string>} */
const ALLOWED_IMAGE_MIMES = new Set([
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
])

/** @type {Map<string, string>} 扩展名（含点）→ 期望 MIME */
const EXT_TO_MIME = new Map([
	['.jpg', 'image/jpeg'],
	['.jpeg', 'image/jpeg'],
	['.png', 'image/png'],
	['.gif', 'image/gif'],
	['.webp', 'image/webp'],
])

/**
 * 从 express-fileupload 填充的 `req.files` 取单字段文件（fount 全局中间件已解析 multipart）。
 * @param {import('npm:express').Request} req HTTP 请求
 * @param {string} field 表单字段名
 * @returns {{ buffer: Buffer, originalname: string, mimetype: string } | null} 文件或 null
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
 * @param {string} extname 带点扩展名
 * @returns {string | null} 期望 MIME
 */
function expectedMimeFromExt(extname) {
	return EXT_TO_MIME.get(String(extname || '').toLowerCase()) ?? null
}

/**
 * @param {{ buffer: Buffer, originalname: string, mimetype: string }} file 上传文件
 * @returns {Promise<boolean>} 是否为允许的图片类型
 */
export async function isAllowedImageUpload(file) {
	if (!file?.buffer?.length) return false
	const ext = path.extname(file.originalname).toLowerCase()
	const expectedMime = expectedMimeFromExt(ext)
	const declaredMime = String(file.mimetype || '').toLowerCase().split(';')[0].trim()
	if (!expectedMime || !ALLOWED_IMAGE_MIMES.has(expectedMime)) return false
	if (declaredMime !== expectedMime) return false
	const sniffed = (await fileTypeFromBuffer(file.buffer))?.mime
	if (!sniffed || !ALLOWED_IMAGE_MIMES.has(sniffed)) return false
	return sniffed === expectedMime
}
