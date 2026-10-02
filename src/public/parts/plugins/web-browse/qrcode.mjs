import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { redactSecrets } from '../../../../scripts/secret_filter.mjs'
import { renderMarkdownCodeBlock } from '../../shells/chat/src/streaming/index.mjs'
import { resolveEffectiveLog } from '../file-operations/src/context_files.mjs'

/**
 * 不使用 AI 或浏览器全局对象，解码附件中的全部二维码。
 * @param {Uint8Array} buffer Image bytes.
 * @returns {Promise<string[]>} Unique decoded contents.
 */
export async function decodeQrCodeFromBuffer(buffer) {
	if (buffer.byteLength > 20 * 1024 * 1024) throw new Error('二维码图片超过 20 MiB，未预读。')
	const { createCanvas, loadImage } = await import('npm:@napi-rs/canvas')
	const image = await loadImage(Buffer.from(buffer))
	const scale = Math.min(1, 2048 / Math.max(image.width, image.height))
	const width = Math.max(1, Math.round(image.width * scale))
	const height = Math.max(1, Math.round(image.height * scale))
	const context = createCanvas(width, height).getContext('2d')
	context.fillStyle = 'white'
	context.fillRect(0, 0, width, height)
	context.drawImage(image, 0, 0, width, height)
	const { grayscale, binarize, Detector, Decoder } = await import('npm:@nuintun/qrcode')
	const matrix = binarize(grayscale(context.getImageData(0, 0, width, height)), width, height)
	const decoder = new Decoder()
	const results = new Set()
	// Try both polarities so light codes on dark backgrounds also work.
	for (let polarity = 0; polarity < 2; polarity++) {
		const detected = new Detector().detect(matrix)
		let current = detected.next()
		while (!current.done) {
			let succeeded = false
			try {
				const { content } = decoder.decode(current.value.matrix)
				if (content) results.add(content)
				succeeded = true
			} catch { /* A finder candidate need not be a valid code. */ }
			current = detected.next(succeeded)
		}
		matrix.flip()
	}
	return [...results]
}

/**
 * 按图片哈希持久化附件二维码结果，空结果与失败结果也一并记录。
 * @param {object} args Reply context.
 * @param {object} options Dependencies.
 * @param {Function} [options.decodeQr] Image decoder.
 * @returns {Promise<string[]>} Decoded contents for URL metadata preload.
 */
export async function preloadQrCodes(args, { decodeQr = decodeQrCodeFromBuffer } = {}) {
	if (!args.AddLongTimeLog) return []
	const logs = resolveEffectiveLog(args)
	args.extension ??= {}
	const cached = args.extension.webBrowsePreloadedQr ??= []
	const records = logs.flatMap(entry => entry?.extension?.pluginData?.['web-browse']?.qrImages || [])
	const known = new Set([...records, ...cached].map(item => item.hash))
	const contents = new Set([...records, ...cached].flatMap(item => item.contents || []))
	const images = logs.slice(-20).flatMap(entry => entry.files || []).filter(file => file?.mime_type?.startsWith('image/') && file.buffer != null)
	let processed = 0
	for (const file of images.toReversed()) {
		const buffer = Buffer.from(file.buffer)
		const hash = createHash('sha256').update(buffer).digest('hex')
		if (known.has(hash)) continue
		if (processed++ >= 5) break
		const record = { hash, contents: [] }
		let error
		try { record.contents = [...new Set(await decodeQr(buffer))] } catch (failure) { error = failure.message }
		for (const value of record.contents) contents.add(value)
		const content = `图片二维码预读（${file.name || '图片附件'}）：\n${error ? `识别失败：${error}` : record.contents.length ? record.contents.join('\n') : '未识别到二维码。'}`
		args.AddLongTimeLog({ id: `web-browse-qr:${hash}`, name: 'web-browse.qrcode', role: 'tool', charVisibility: [args.char_id], content: redactSecrets(content), content_for_show: renderMarkdownCodeBlock(content), files: [], extension: { pluginData: { 'web-browse': { qrImages: [record] } } } })
		known.add(hash)
		cached.push(record)
	}
	return [...contents]
}
