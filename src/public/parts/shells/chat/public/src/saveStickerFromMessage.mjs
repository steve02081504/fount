/**
 * 【文件】public/src/saveStickerFromMessage.mjs
 * 【职责】从群消息贴纸 content 保存到用户贴纸库（§6）。
 * 【原理】解析 content 中 image ref → blob → POST 用户 stickers API。
 * 【数据结构】message content 对象、Blob。
 * 【关联】Hub 消息菜单；stickers shell 数据。
 */
/**
 * @param {Blob} blob 图片 blob
 * @returns {Promise<string>} data URL 字符串
 */
async function blobToDataUrl(blob) {
	return await new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.addEventListener('load', () => resolve(String(reader.result || '')), { once: true })
		reader.addEventListener('error', () => reject(reader.error), { once: true })
		reader.readAsDataURL(blob)
	})
}

/**
 * @param {string} src data URL 或 http(s) URL
 * @returns {Promise<string>} data:image/* URL
 */
async function toImageDataUrl(src) {
	const s = String(src || '').trim()
	if (s.startsWith('data:image/')) return s
	const response = await fetch(s, { credentials: 'include' })
	if (!response.ok) throw new Error(`fetch sticker failed: ${response.status}`)
	const blob = await response.blob()
	if (!String(blob.type || '').startsWith('image/')) throw new Error('not an image')
	return blobToDataUrl(blob)
}

/**
 * 将消息中的贴纸保存到本用户贴纸包并收藏。
 * @param {object} content 消息 `content`（`stickerBase64` / `stickerName`）
 * @returns {Promise<object>} 服务端返回的 sticker 对象
 */
export async function saveStickerFromMessage(content) {
	const src = content?.stickerBase64
	if (!src) throw new Error('no sticker in message')
	const dataUrl = await toImageDataUrl(src)
	const name = String(content?.stickerName || content?.stickerId || 'saved').trim().slice(0, 120)
	const response = await fetch('/api/parts/shells:chat/stickers/import', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ dataUrl, name }),
	})
	const data = await response.json()
	if (!response.ok) throw new Error(data.error || 'import failed')
	return data.sticker
}
