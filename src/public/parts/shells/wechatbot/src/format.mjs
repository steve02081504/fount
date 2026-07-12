import { Buffer } from 'node:buffer'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { where_command } from 'npm:@steve02081504/exec'
import ffmpeg from 'npm:fluent-ffmpeg'
import mimetype from 'npm:mime-types'

import { console } from '../../../../../scripts/i18n/bare.mjs'

import {
	decryptAesEcb,
	downloadCdnBuffer,
	parseInboundAesKey,
	UploadMediaType,
} from './wechat_api.mjs'

ffmpeg.setFfmpegPath(await where_command('ffmpeg') || (await import('npm:@ffmpeg-installer/ffmpeg')).default.path)

const MessageItemType = { TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 }
const WECHAT_TEXT_MAX_BYTES = 2048

const WECHAT_SUPPORTED_IMAGE_MIMES = new Set([
	'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
])
const WECHAT_SUPPORTED_AUDIO_MIMES = new Set([
	'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
	'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/x-aac', 'audio/amr',
])
const WECHAT_SUPPORTED_VIDEO_MIMES = new Set(['video/mp4', 'video/x-m4v'])
const IMAGE_NAME_REGEXP = /\.(jpeg|jpg|png|gif|webp|bmp)$/i
const VIDEO_NAME_REGEXP = /\.(mp4|mov|avi|mkv|webm)$/i
const AUDIO_NAME_REGEXP = /\.(mp3|ogg|wav|m4a|aac|flac)$/i

/**
 *
 * @param text
 * @param maxBytes
 */
function hardSplitByBytes(text, maxBytes) {
	const textEncoder = new TextEncoder()
	const utf8Bytes = textEncoder.encode(text)
	if (utf8Bytes.length <= maxBytes) return [text]
	const textDecoder = new TextDecoder()
	const chunks = []
	let offset = 0
	while (offset < utf8Bytes.length) {
		let end = Math.min(offset + maxBytes, utf8Bytes.length)
		while (end > offset && (utf8Bytes[end] & 0xC0) === 0x80) end--
		if (end === offset) {
			end = offset + 1
			while (end < utf8Bytes.length && (utf8Bytes[end] & 0xC0) === 0x80) end++
		}
		chunks.push(textDecoder.decode(utf8Bytes.subarray(offset, end)).trim())
		offset = end
	}
	return chunks.filter(Boolean)
}

/**
 * 按微信 UTF-8 字节限制分割文本。
 * @param {string} text 原文
 * @param {number} [maxBytes] 每段最大字节
 * @returns {string[]}
 */
export function splitWechatText(text, maxBytes = WECHAT_TEXT_MAX_BYTES) {
	const textEncoder = new TextEncoder()
	if (!text || textEncoder.encode(text).length <= maxBytes) return text ? [text] : []
	const parts = text.split(/(?<=[\n!,.;?、。！，；？])/)
	const chunks = []
	let current = ''
	for (const part of parts) {
		const candidate = current + part
		if (textEncoder.encode(candidate).length > maxBytes) {
			if (current) chunks.push(current.trim())
			if (textEncoder.encode(part).length > maxBytes)
				chunks.push(...hardSplitByBytes(part, maxBytes))
			else
				current = part
		}
		else
			current = candidate
	}
	if (current.trim()) chunks.push(current.trim())
	return chunks.filter(Boolean)
}

/**
 *
 * @param name
 */
function guessMimeFromFileName(name) {
	const lowerFileName = String(name).toLowerCase()
	return [
		[/\.(jpe?g)$/, 'image/jpeg'],
		[/\.png$/, 'image/png'],
		[/\.gif$/, 'image/gif'],
		[/\.webp$/, 'image/webp'],
		[/\.(mp4|m4v)$/, 'video/mp4'],
		[/\.(mp3|m4a)$/, 'audio/mpeg'],
		[/\.wav$/, 'audio/wav'],
	].find(([pattern]) => pattern.test(lowerFileName))?.[1] ?? 'application/octet-stream'
}

/**
 *
 * @param mimeType
 * @param fileName
 */
function getInputExt(mimeType, fileName) {
	const ext = mimetype.extension(mimeType)
	if (ext) return `.${ext}`
	const fileExt = fileName.includes('.') ? `.${fileName.split('.').pop()}` : ''
	return fileExt || '.bin'
}

/**
 *
 * @param buffer
 * @param inputExt
 */
async function isAnimatedMedia(buffer, inputExt) {
	const tempDir = mkdtempSync(join(tmpdir(), 'fount-wechat-probe-'))
	try {
		const inputPath = join(tempDir, `input${inputExt}`)
		writeFileSync(inputPath, buffer)
		const metadata = await new Promise((resolve, reject) =>
			ffmpeg.ffprobe(inputPath, (err, data) => err ? reject(err) : resolve(data))
		)
		const nbFrames = parseInt(metadata?.streams?.[0]?.nb_frames ?? '1', 10)
		return nbFrames > 1
	}
	catch {
		return false
	}
	finally {
		rmSync(tempDir, { recursive: true, force: true })
	}
}

/**
 *
 * @param buffer
 * @param inputExt
 * @param outputExt
 * @param extraArgs
 */
async function convertBufferWithFfmpeg(buffer, inputExt, outputExt, extraArgs = []) {
	const tempDir = mkdtempSync(join(tmpdir(), 'fount-wechat-'))
	try {
		const inputPath = join(tempDir, `input${inputExt}`)
		const outputPath = join(tempDir, `output${outputExt}`)
		writeFileSync(inputPath, buffer)
		await new Promise((resolve, reject) => {
			let cmd = ffmpeg(inputPath)
			for (const arg of extraArgs) cmd = cmd.addOption(arg)
			cmd.output(outputPath)
				.on('end', resolve)
				.on('error', reject)
				.run()
		})
		return readFileSync(outputPath)
	}
	finally {
		rmSync(tempDir, { recursive: true, force: true })
	}
}

/**
 * 若文件格式微信不支持，自动转换为兼容格式。
 * @param {{ name?: string, buffer?: Buffer, mime_type?: string }} file 文件对象
 * @returns {Promise<typeof file>}
 */
export async function convertFileToWechatCompatible(file) {
	if (!file?.buffer) return file
	const mimeType = String(file.mime_type || '').toLowerCase()
	const fileName = String(file.name || 'file')
	const baseName = fileName.replace(/\.[^.]*$/, '')
	const inputExt = getInputExt(mimeType, fileName)

	if (mimeType.startsWith('image/') && !WECHAT_SUPPORTED_IMAGE_MIMES.has(mimeType)) {
		const animated = await isAnimatedMedia(file.buffer, inputExt)
		const [outExt, outMime] = animated ? ['.gif', 'image/gif'] : ['.png', 'image/png']
		try {
			const convertedBuffer = await convertBufferWithFfmpeg(file.buffer, inputExt, outExt)
			return { ...file, name: `${baseName}${outExt}`, mime_type: outMime, buffer: convertedBuffer }
		}
		catch (err) {
			console.error(`[WechatBridge] 图片转换失败 ${fileName}:`, err)
		}
	}

	if (mimeType.startsWith('audio/') && !WECHAT_SUPPORTED_AUDIO_MIMES.has(mimeType)) try {
		const convertedBuffer = await convertBufferWithFfmpeg(file.buffer, inputExt, '.mp3',
			['-acodec', 'libmp3lame', '-q:a', '2'])
		return { ...file, name: `${baseName}.mp3`, mime_type: 'audio/mpeg', buffer: convertedBuffer }
	}
	catch (err) {
		console.error(`[WechatBridge] 音频转换失败 ${fileName}:`, err)
	}

	if (mimeType.startsWith('video/') && !WECHAT_SUPPORTED_VIDEO_MIMES.has(mimeType)) try {
		const convertedBuffer = await convertBufferWithFfmpeg(file.buffer, inputExt, '.mp4',
			['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart'])
		return { ...file, name: `${baseName}.mp4`, mime_type: 'video/mp4', buffer: convertedBuffer }
	}
	catch (err) {
		console.error(`[WechatBridge] 视频转换失败 ${fileName}:`, err)
	}

	return file
}

/**
 *
 * @param wechatMessage
 */
function extractInboundText(wechatMessage) {
	return (wechatMessage.item_list || [])
		.filter(item => item.type === MessageItemType.TEXT && item.text_item?.text)
		.map(item => item.text_item.text)
		.join('\n').trim()
}

/**
 *
 * @param wechatMessage
 */
function hasDownloadableMediaItem(wechatMessage) {
	return (wechatMessage.item_list || []).some(item =>
		['image_item', 'file_item', 'video_item', 'voice_item'].some(key => {
			const media = item[key]?.media
			return media && (media.encrypt_query_param || media.full_url)
		})
	)
}

/**
 *
 * @param media
 * @param cdnBaseUrl
 * @param signal
 */
async function downloadAndDecrypt(media, cdnBaseUrl, signal) {
	const encrypted = await downloadCdnBuffer(media.encrypt_query_param || '', cdnBaseUrl, media.full_url, signal)
	return decryptAesEcb(encrypted, parseInboundAesKey(media.aes_key))
}

/**
 *
 * @param item
 * @param cdnBaseUrl
 * @param signal
 */
async function downloadAndDecryptMediaItem(item, cdnBaseUrl, signal) {
	try {
		if (item.type === MessageItemType.IMAGE) {
			const img = item.image_item
			const media = img?.media
			if (!media || (!media.encrypt_query_param && !media.full_url)) return null
			const hexKey = img.aeskey && /^[\da-f]{32}$/i.test(String(img.aeskey).trim())
				? String(img.aeskey).trim()
				: ''
			const aesKeyBase64 = hexKey
				? Buffer.from(hexKey, 'hex').toString('base64')
				: media.aes_key
			const encrypted = await downloadCdnBuffer(media.encrypt_query_param || '', cdnBaseUrl, media.full_url, signal)
			const imageBuffer = aesKeyBase64
				? decryptAesEcb(encrypted, parseInboundAesKey(aesKeyBase64))
				: encrypted
			return { name: 'wechat_image.bin', buffer: imageBuffer, mime_type: 'image/jpeg' }
		}
		if (item.type === MessageItemType.FILE) {
			const fileItem = item.file_item
			const media = fileItem?.media
			if (!media?.aes_key || (!media.encrypt_query_param && !media.full_url)) return null
			const decryptedBuffer = await downloadAndDecrypt(media, cdnBaseUrl, signal)
			const name = fileItem.file_name || 'file.bin'
			return { name, buffer: decryptedBuffer, mime_type: guessMimeFromFileName(name) }
		}
		if (item.type === MessageItemType.VIDEO) {
			const videoItem = item.video_item
			const media = videoItem?.media
			if (!media?.aes_key || (!media.encrypt_query_param && !media.full_url)) return null
			const decryptedBuffer = await downloadAndDecrypt(media, cdnBaseUrl, signal)
			return { name: 'wechat_video.mp4', buffer: decryptedBuffer, mime_type: 'video/mp4' }
		}
		if (item.type === MessageItemType.VOICE) {
			const voiceItem = item.voice_item
			if (voiceItem?.text) return null
			const media = voiceItem?.media
			if (!media?.aes_key || (!media.encrypt_query_param && !media.full_url)) return null
			const decryptedBuffer = await downloadAndDecrypt(media, cdnBaseUrl, signal)
			return { name: 'wechat_voice.silk', buffer: decryptedBuffer, mime_type: 'application/octet-stream' }
		}
	}
	catch (err) {
		console.error('[WechatBridge] 入站媒体下载/解密失败:', err)
	}
	return null
}

/**
 * @param {object} wechatMessage 微信消息
 * @param {string} ownerUsername replica
 * @param {string} cdnBaseUrl CDN 根
 * @param {AbortSignal} signal 中止信号
 * @param {string} [ownerDisplayName] 主人显示名
 * @returns {Promise<object | null>} bridge DTO
 */
export async function wechatMessageToBridgeDto(wechatMessage, ownerUsername, cdnBaseUrl, signal, ownerDisplayName = '') {
	const text = extractInboundText(wechatMessage)
	const files = (await Promise.all(
		(wechatMessage.item_list || []).map(item => downloadAndDecryptMediaItem(item, cdnBaseUrl, signal))
	)).filter(Boolean)
	if (!text.trim() && !files.length) return null

	const fromUserId = String(wechatMessage.from_user_id || '').trim()
	if (!fromUserId) return null

	return {
		platform: 'wechat',
		platformChatId: fromUserId,
		platformMessageId: String(wechatMessage.message_id ?? wechatMessage.seq ?? crypto.randomUUID()),
		chatKind: 'dm',
		chatName: ownerDisplayName || `WeChat:${fromUserId}`,
		author: {
			platformUserId: fromUserId,
			displayName: ownerDisplayName || fromUserId,
		},
		text,
		files: files.length ? files : undefined,
		timestamp: wechatMessage.create_time_ms ?? Date.now(),
		extension: {
			wechat_context_token: wechatMessage.context_token || '',
		},
	}
}

/**
 * 检测上传媒体类型。
 * @param {{ name?: string, mime_type?: string }} fileLike 文件
 * @returns {number}
 */
export function detectWechatUploadMediaType(fileLike) {
	const mimeType = String(fileLike?.mime_type || '').toLowerCase()
	const fileName = String(fileLike?.name || '').toLowerCase()
	if (WECHAT_SUPPORTED_IMAGE_MIMES.has(mimeType) || IMAGE_NAME_REGEXP.test(fileName))
		return UploadMediaType.IMAGE
	if (mimeType.startsWith('video/') || VIDEO_NAME_REGEXP.test(fileName))
		return UploadMediaType.VIDEO
	if (mimeType.startsWith('audio/') || AUDIO_NAME_REGEXP.test(fileName))
		return UploadMediaType.VOICE
	return UploadMediaType.FILE
}

/**
 * 构建微信出站媒体 item。
 * @param {object} args 参数
 * @returns {object}
 */
export function buildWechatMediaMessageItem(args) {
	/**
	 *
	 * @param cdnMedia
	 */
	const outboundMedia = cdnMedia => ({ ...cdnMedia, encrypt_type: 1 })
	if (args.uploadMediaType === UploadMediaType.IMAGE)
		return {
			type: MessageItemType.IMAGE,
			image_item: { media: outboundMedia(args.media), mid_size: args.ciphertextSize },
		}
	if (args.uploadMediaType === UploadMediaType.VIDEO)
		return {
			type: MessageItemType.VIDEO,
			video_item: { media: outboundMedia(args.media), video_size: args.ciphertextSize },
		}
	if (args.uploadMediaType === UploadMediaType.VOICE)
		return {
			type: MessageItemType.VOICE,
			voice_item: { media: outboundMedia(args.media) },
		}
	return {
		type: MessageItemType.FILE,
		file_item: {
			media: outboundMedia(args.media),
			file_name: args.file.name || 'file',
			len: String(args.fileSize),
		},
	}
}

/**
 *
 */
export const WechatMessageItemType = MessageItemType
/**
 *
 */
export const WechatMessageType = { USER: 1, BOT: 2 }
/**
 *
 */
export const WechatMessageState = { NEW: 0, GENERATING: 1, FINISH: 2 }

/**
 *
 * @param wechatMessage
 */
export function wechatMessageHasContent(wechatMessage) {
	return Boolean(extractInboundText(wechatMessage)) || hasDownloadableMediaItem(wechatMessage)
}
