import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'

import { getFileExtFromMimetype, mimetypeFromBufferAndName } from './mimetype.mjs'

/**
 * 解析 HTTP 附件文件名，优先采用 RFC 5987 的 Content-Disposition。
 * @param {string} url Attachment URL.
 * @param {string} disposition Content-Disposition header.
 * @returns {string} Attachment basename.
 */
export function attachmentFilename(url, disposition = '') {
	const extended = /filename\*\s*=\s*(?:"([^"\r\n]*)"|([^;\r\n]*))/i.exec(disposition)
	const ordinary = /filename\s*=\s*(?:"((?:\\.|[^"\r\n])*)"|([^;\r\n]*))/i.exec(disposition)
	let name = extended?.[1] ?? extended?.[2]
	if (name) {
		const encoded = /^([^']*)'[^']*'(.*)$/.exec(name.trim())
		try { name = decodeURIComponent(encoded?.[2] ?? name) } catch { name = '' }
	}
	name ||= (ordinary?.[1] ?? ordinary?.[2] ?? '').trim().replace(/\\"/g, '"')
	if (!name)
		try { name = decodeURIComponent(new URL(url).pathname.split('/').at(-1) || '') } catch { name = '' }

	return name.replace(/\\/g, '/').split('/').at(-1).replace(/[\x00-\x1f\x7f]/g, '').trim()
}

/**
 * 规范化本地路径、URL 与附件对象，保留可选元数据。
 * @param {string|object} input Attachment source.
 * @param {object} root0 Normalization options.
 * @param {Function} root0.resolvePath Local path resolver.
 * @param {Function} root0.fetchImpl HTTP fetch implementation.
 * @returns {Promise<object>} Attachment with buffer, name, MIME and optional metadata.
 */
export async function toFileObj(input, { resolvePath = path.resolve, fetchImpl = fetch } = {}) {
	let file = input
	if (typeof input === 'string' || input instanceof String) {
		const source = String(input)
		if (/^https?:\/\//i.test(source)) {
			const response = await fetchImpl(source)
			if (!response.ok) throw new Error(`Attachment fetch failed: HTTP ${response.status}`)
			file = {
				name: attachmentFilename(response.url || source, response.headers.get('content-disposition') || ''),
				buffer: Buffer.from(await response.arrayBuffer()),
				mime_type: response.headers.get('content-type')?.split(';')[0].trim(),
			}
		} else {
			const absolute = await resolvePath(source)
			file = { name: path.basename(absolute), buffer: await fs.readFile(absolute) }
		}
	}
	if (!file || file.buffer == null) throw new TypeError('Attachment requires a buffer or a file path/URL')
	const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer)
	const inferred = await mimetypeFromBufferAndName(buffer, file.name || '')
	const mime_type = !file.mime_type || file.mime_type === 'application/octet-stream' ? inferred : file.mime_type
	const name = file.name || `downloaded.${getFileExtFromMimetype(mime_type) || 'bin'}`
	return { ...file, name, buffer, mime_type }
}
