/**
 * Express fileupload 解析后的 multipart 辅助（server 层，供 P2P/核心路由使用）。
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

/** @type {Map<string, string>} */
const EXT_TO_MIME = new Map([
	['.jpg', 'image/jpeg'],
	['.jpeg', 'image/jpeg'],
	['.png', 'image/png'],
	['.gif', 'image/gif'],
	['.webp', 'image/webp'],
])

/**
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
 * @param {{ buffer: Buffer, originalname: string, mimetype: string }} file 上传文件
 * @returns {Promise<boolean>} 是否为允许图片
 */
export async function isAllowedImageUpload(file) {
	if (!file?.buffer?.length) return false
	const ext = path.extname(file.originalname).toLowerCase()
	const expectedMime = EXT_TO_MIME.get(ext)
	const declaredMime = String(file.mimetype || '').toLowerCase().split(';')[0].trim()
	if (!expectedMime || !ALLOWED_IMAGE_MIMES.has(expectedMime)) return false
	if (declaredMime !== expectedMime) return false
	const sniffed = (await fileTypeFromBuffer(file.buffer))?.mime
	if (!sniffed || !ALLOWED_IMAGE_MIMES.has(sniffed)) return false
	return sniffed === expectedMime
}
