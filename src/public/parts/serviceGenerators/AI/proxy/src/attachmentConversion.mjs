/** 进程内可用的图像编码器；目标选择以允许列表顺序为准。 */
const IMAGE_FORMATS = new Map([
	['image/png', 'png'], ['image/jpeg', 'jpeg'], ['image/webp', 'webp'],
	['image/gif', 'gif'], ['image/avif', 'avif'], ['image/tiff', 'tiff'],
])
/** 无需重编码的等价 MIME 写法。 */
const MIME_ALIASES = [
	['audio/mpeg', 'audio/mp3'],
	['audio/wav', 'audio/wave', 'audio/x-wav'],
	['image/jpeg', 'image/jpg'],
]
/** 可表示为纯 UTF-8 文本的文本格式。 */
const TEXT_TYPES = new Set(['application/json', 'application/xml', 'application/yaml'])

/**
 * 剥离 MIME 参数并归一化为小写（`image/PNG; charset=utf-8` → `image/png`）。
 * @param {string} mimeType 原始 MIME
 * @returns {string} 基础 MIME
 */
export function mimeTypeBase(mimeType) {
	return String(mimeType || '').split(';')[0].trim().toLowerCase()
}

/**
 * 允许的字节原样保留，否则转换为兼容的允许 MIME。
 * 无允许列表表示原样，空列表表示全不允许；无法转换或解码失败返回 null。
 * 图像转换取首帧并应用方向，不启动外部进程。
 * @param {Buffer} bytes 附件字节
 * @param {string} mime 基础附件 MIME
 * @param {string[] | null} [allowedMimeTypes] 精确 MIME 列表，顺序即目标优先级
 * @returns {Promise<{ bytes: Buffer, mime: string } | null>} 允许的内容或无可转换目标
 */
export async function convertAttachment(bytes, mime, allowedMimeTypes = null) {
	if (allowedMimeTypes == null) return { bytes, mime }
	const allowed = allowedMimeTypes.map(mimeTypeBase)
	mime = mimeTypeBase(mime)
	if (allowed.includes(mime)) return { bytes, mime }
	const aliases = MIME_ALIASES.find(group => group.includes(mime))
	const alias = allowed.find(type => aliases?.includes(type))
	if (alias) return { bytes, mime: alias }
	try {
		if (mime.startsWith('image/')) {
			const target = allowed.find(type => IMAGE_FORMATS.has(type))
			if (!target) return null
			const { default: sharp } = await import('npm:sharp')
			let image = sharp(bytes).autoOrient()
			if (target === 'image/jpeg') image = image.flatten({ background: '#ffffff' })
			return { bytes: await image.toFormat(IMAGE_FORMATS.get(target)).toBuffer(), mime: target }
		}
		if ((mime.startsWith('text/') || TEXT_TYPES.has(mime)) && allowed.includes('text/plain')) {
			new TextDecoder('utf-8', { fatal: true }).decode(bytes)
			return { bytes, mime: 'text/plain' }
		}
	}
	catch { /* 调用方以系统提示替代无法解码的内容。 */ }
	return null
}
