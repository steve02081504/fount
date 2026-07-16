/**
 * 上传时生成 AVIF（降级 webp）预览图。
 */

const MAX_EDGE = 320

/**
 * @param {CanvasImageSource} source 源
 * @param {number} width 宽
 * @param {number} height 高
 * @returns {Promise<Blob | null>} 预览 blob
 */
async function canvasToPreviewBlob(source, width, height) {
	const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
	const w = Math.max(1, Math.round(width * scale))
	const h = Math.max(1, Math.round(height * scale))
	const canvas = document.createElement('canvas')
	canvas.width = w
	canvas.height = h
	const ctx = canvas.getContext('2d')
	ctx.drawImage(source, 0, 0, w, h)
	const avif = await new Promise(resolve => canvas.toBlob(resolve, 'image/avif', 0.6))
	if (avif) return avif
	return new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.75))
}

/**
 * @param {File} file 图片文件
 * @returns {Promise<Blob | null>} 预览
 */
async function previewFromImage(file) {
	const bitmap = await createImageBitmap(file)
	try {
		return await canvasToPreviewBlob(bitmap, bitmap.width, bitmap.height)
	}
	finally {
		bitmap.close?.()
	}
}

/**
 * @param {File} file 视频文件
 * @returns {Promise<Blob | null>} 预览
 */
async function previewFromVideo(file) {
	const url = URL.createObjectURL(file)
	try {
		const video = document.createElement('video')
		video.preload = 'metadata'
		video.muted = true
		video.src = url
		await new Promise((resolve, reject) => {
			video.onloadeddata = resolve
			video.onerror = reject
		})
		const seekTo = Math.min(1, (video.duration || 1) * 0.1)
		video.currentTime = seekTo
		await new Promise(resolve => { video.onseeked = resolve })
		return await canvasToPreviewBlob(video, video.videoWidth || 320, video.videoHeight || 180)
	}
	finally {
		URL.revokeObjectURL(url)
	}
}

/**
 * @param {File} file 本地文件
 * @returns {Promise<Blob | null>} 预览 blob；非多媒体返回 null
 */
export async function generateUploadPreview(file) {
	const type = file.type || ''
	if (type.startsWith('image/')) return previewFromImage(file)
	if (type.startsWith('video/')) return previewFromVideo(file)
	return null
}

/**
 * @param {Blob} blob 预览
 * @returns {Promise<string>} base64
 */
export async function blobToBase64(blob) {
	const buffer = await blob.arrayBuffer()
	let binary = ''
	const bytes = new Uint8Array(buffer)
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary)
}
