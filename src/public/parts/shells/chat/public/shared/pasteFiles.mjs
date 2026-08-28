/**
 * 剪贴板粘贴项 → 附件 File 的纯转换：过滤文本表示（text/html、text/plain 字符串项），
 * 声明类型缺失或被误标为 text/* / octet-stream 时按字节魔数修正 MIME。
 */
import { fileTypeFromBuffer } from 'https://esm.sh/file-type'

/**
 * 仅按字节魔数嗅探 MIME（不回退文件名 / 文本判定）。
 * @param {ArrayBuffer | Uint8Array | Blob} buffer 内容（或前 N 字节）
 * @returns {Promise<string | null>} MIME；无法识别时 null
 */
export async function sniffMimeFromBuffer(buffer) {
	if (!buffer) return null
	const bytes = buffer instanceof Uint8Array
		? buffer
		: buffer instanceof Blob
			? new Uint8Array(await buffer.arrayBuffer())
			: new Uint8Array(buffer)
	if (!bytes.length) return null
	return (await fileTypeFromBuffer(bytes))?.mime ?? null
}

/**
 * 将剪贴板项转为附件 File；文本表示项返回 null。
 * @param {object} item - 剪贴板项（DataTransferItem 子集：kind / type / getAsFile）。
 * @returns {Promise<File | null>} 附件 File 或 null
 */
export async function fileFromClipboardItem(item) {
	if (item.kind && item.kind !== 'file') return null
	const blob = item.getAsFile?.()
	if (!blob) return null
	let type = (item.type || blob.type || '').trim()
	if (!type || /^(text\/|application\/octet-stream)/i.test(type)) {
		const sniffed = await sniffMimeFromBuffer(await blob.slice(0, 4096).arrayBuffer())
		if (sniffed) type = sniffed
	}
	if (!type) type = 'application/octet-stream'
	const ext = type.includes('/') ? type.split('/')[1].split(';')[0] : 'bin'
	const name = blob.name && blob.name !== 'image.png'
		? blob.name
		: `pasted-${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext === 'plain' ? 'txt' : ext}`
	return new File([blob], name, { type })
}
