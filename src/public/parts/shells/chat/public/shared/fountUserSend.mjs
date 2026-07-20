/**
 * `fount.user.send` 入参 → 频道发送载荷（纯函数，Hub / Deno pure 共用）。
 * 勿 import `/scripts/*` 或 `pages/scripts/*`：浏览器 URL 与磁盘布局不一致。
 *
 * `files[].buffer` 约定为 ArrayBuffer（见 world 模板文档）；出口转成 base64 供 `sendMessagePayload`。
 */

/**
 * @param {ArrayBuffer | ArrayBufferView} buffer 附件缓冲
 * @returns {string} base64
 */
function arrayBufferToBase64(buffer) {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary)
}

/**
 * @param {unknown} files chatLogEntry.files
 * @returns {object[]} 上传用附件列表（buffer 已是 base64）
 */
function normalizeSendFiles(files) {
	if (!files?.length) return []
	return files.map(({ name, mime_type, buffer, description }) => {
		if (!(buffer instanceof ArrayBuffer || ArrayBuffer.isView(buffer)))
			throw new Error('file.buffer must be ArrayBuffer')
		return {
			name: String(name || 'file'),
			mime_type: String(mime_type || 'application/octet-stream'),
			buffer: arrayBufferToBase64(buffer),
			description: String(description || ''),
		}
	})
}

/**
 * 将 `fount.user.send` 入参规范为频道发送载荷。
 * @param {string | object} input 纯文本或近似 `chatLogEntry_t` 的对象
 * @param {{ locale?: string }} [defaults] 缺省 locale（Hub 传 primaryLocale）
 * @returns {{ content: object, files: object[] }} content + files
 */
export function normalizeUserSendPayload(input, defaults = {}) {
	const fallbackLocale = defaults.locale || 'en-UK'
	if (typeof input === 'string')
		return {
			content: {
				type: 'text',
				content: input,
				locale: fallbackLocale,
			},
			files: [],
		}

	if (!input || typeof input !== 'object')
		throw new Error('fount.user.send expects string or chatLogEntry')

	const content = {
		type: 'text',
		content: String(input.content ?? ''),
		locale: input.locale != null ? String(input.locale) : fallbackLocale,
	}
	if (input.content_for_show != null) content.content_for_show = String(input.content_for_show)
	if (input.content_for_edit != null) content.content_for_edit = String(input.content_for_edit)
	if (input.content_warning != null) content.content_warning = String(input.content_warning)
	if (input.sensitive_media) content.sensitive_media = true

	return { content, files: normalizeSendFiles(input.files) }
}
