import { Buffer } from 'node:buffer'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { where_command } from 'npm:@steve02081504/exec'
import ffmpeg from 'npm:fluent-ffmpeg'
import mimetype from 'npm:mime-types'

import { localhostLocales, console } from '../../../../../../scripts/i18n.mjs'
import { getAnyPreferredDefaultPart, loadPart } from '../../../../../../server/parts_loader.mjs'
import {
	DEFAULT_LONG_POLL_TIMEOUT_MS,
	DEFAULT_WECHAT_ILINK_BASE,
	UploadMediaType,
	decryptAesEcb,
	downloadCdnBuffer,
	parseInboundAesKey,
} from '../wechat_api.mjs'

ffmpeg.setFfmpegPath(await where_command('ffmpeg').catch(() => import('npm:@ffmpeg-installer/ffmpeg').then(m => m.default.path)))

/** @typedef {import('../../../chat/decl/chatLog.ts').chatReply_t} ChatReply_t */
/** @typedef {import('../../../chat/decl/chatLog.ts').chatLogEntry_t} FountChatLogEntryBase */
/** @typedef {FountChatLogEntryBase & { extension?: { wechat_message_id?: string, [key: string]: any } }} chatLogEntry_t_simple */

/**
 * 按用户/角色索引当前正在运行的微信 Bot 对外 JS API（发消息、读历史等）。
 * @type {Record<string, Record<string, object>>}
 */
const charWechatRuntimeRegistry = {}

/**
 * 获取指定用户下指定角色当前微信 Bot 的 JS 可调接口（与 discord-api 的 Client 暴露方式对齐）。
 * @param {string} username fount 用户名
 * @param {string} charname 角色名（char_id）
 * @returns {object | undefined} wechat_api 运行时对象，未运行微信 Bot 时为 undefined
 */
export function getWechatRuntimeForChar(username, charname) {
	return charWechatRuntimeRegistry[username]?.[charname]
}

const MessageType = { USER: 1, BOT: 2 }
const MessageItemType = { TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 }
const MessageState = { NEW: 0, GENERATING: 1, FINISH: 2 }

const IMAGE_NAME_REGEXP = /\.(jpeg|jpg|png|gif|webp|bmp)$/i
const VIDEO_NAME_REGEXP = /\.(mp4|mov|avi|mkv|webm)$/i
const AUDIO_NAME_REGEXP = /\.(mp3|ogg|wav|m4a|aac|flac)$/i

/** 微信可直接发送为 IMAGE 类型的 MIME */
const WECHAT_SUPPORTED_IMAGE_MIMES = new Set([
	'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
])
/** 微信可直接发送为 VOICE 类型的 MIME */
const WECHAT_SUPPORTED_AUDIO_MIMES = new Set([
	'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
	'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/x-aac', 'audio/amr',
])
/** 微信可直接发送为 VIDEO 类型的 MIME */
const WECHAT_SUPPORTED_VIDEO_MIMES = new Set(['video/mp4', 'video/x-m4v'])

/** 微信文本 content 上限 2048 字节（UTF-8） */
const WECHAT_TEXT_MAX_BYTES = 2048

/**
 * 在字符边界处将 text 截成不超过 maxBytes 字节的若干段。
 * @param {string} text 原文。
 * @param {number} maxBytes 每段最大 UTF-8 字节数。
 * @returns {string[]} 每段不超过 maxBytes 字节的子串数组。
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
 * 按微信 UTF-8 字节限制分割文本；优先在标点处断句，超长段用字符边界硬切。
 * @param {string} text 原文。
 * @param {number} [maxBytes] 每段最大 UTF-8 字节数。
 * @returns {string[]} 符合微信单条字节上限的文本段数组。
 */
function splitWechatText(text, maxBytes = WECHAT_TEXT_MAX_BYTES) {
	const textEncoder = new TextEncoder()
	if (!text || textEncoder.encode(text).length <= maxBytes) return text ? [text] : []
	const parts = text.split(/(?<=[。！？.!?；;,，、\n])/)
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
 * 提取微信消息的文本内容。
 * @param {object} msg 微信消息对象。
 * @returns {string} 拼接后的文本内容，无文本时返回空字符串。
 */
function extractInboundText(msg) {
	return (msg.item_list || [])
		.filter(item => item.type === MessageItemType.TEXT && item.text_item?.text)
		.map(item => item.text_item.text)
		.join('\n').trim()
}

/**
 * 判断消息是否包含可从 CDN 拉取的媒体项。
 * @param {object} msg 微信消息对象。
 * @returns {boolean} 存在带 encrypt_query_param 或 full_url 的媒体引用时为 true。
 */
function hasDownloadableMediaItem(msg) {
	return (msg.item_list || []).some(item =>
		['image_item', 'file_item', 'video_item', 'voice_item'].some(key => {
			const media = item[key]?.media
			return media && (media.encrypt_query_param || media.full_url)
		})
	)
}

/**
 * 根据文件名猜测 MIME。
 * @param {string} name 文件名。
 * @returns {string} 匹配扩展名时返回对应 MIME，否则为 application/octet-stream。
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
 * 根据 MIME 类型或文件名推断适合 ffmpeg 识别的输入扩展名。
 * @param {string} mimeType MIME 类型。
 * @param {string} fileName 文件名。
 * @returns {string} 包含点号的扩展名，如 ".tiff"。
 */
function getInputExt(mimeType, fileName) {
	const ext = mimetype.extension(mimeType)
	if (ext) return `.${ext}`
	const fileExt = fileName.includes('.') ? `.${fileName.split('.').pop()}` : ''
	return fileExt || '.bin'
}

/**
 * 通过 ffprobe 检测图片/视频是否包含多帧（动图）。
 * @param {Buffer} buffer 文件数据。
 * @param {string} inputExt 含点扩展名。
 * @returns {Promise<boolean>} 是否为动图。
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
 * 用 ffmpeg 将 Buffer 转换格式，返回转换后的 Buffer。
 * @param {Buffer} buffer 原始数据。
 * @param {string} inputExt 输入扩展名（含点）。
 * @param {string} outputExt 输出扩展名（含点）。
 * @param {string[]} [extraArgs] 额外 ffmpeg 参数。
 * @returns {Promise<Buffer>} 转换后的数据。
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
 * 若文件格式微信不支持，自动转换为兼容格式：
 * - image/* 不支持 → PNG
 * - audio/* 不支持 → MP3
 * - video/* 不支持 → MP4
 * @param {{ name?: string, buffer?: Buffer, mime_type?: string }} file 文件对象。
 * @returns {Promise<typeof file>} 转换后的文件对象（格式已支持时原样返回）。
 */
async function convertFileToWechatCompatible(file) {
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
			console.error(`[SimpleWechat] 图片转换失败 ${fileName}:`, err)
		}
	}

	if (mimeType.startsWith('audio/') && !WECHAT_SUPPORTED_AUDIO_MIMES.has(mimeType)) try {
		const convertedBuffer = await convertBufferWithFfmpeg(file.buffer, inputExt, '.mp3',
			['-acodec', 'libmp3lame', '-q:a', '2'])
		return { ...file, name: `${baseName}.mp3`, mime_type: 'audio/mpeg', buffer: convertedBuffer }
	}
	catch (err) {
		console.error(`[SimpleWechat] 音频转换失败 ${fileName}:`, err)
	}

	if (mimeType.startsWith('video/') && !WECHAT_SUPPORTED_VIDEO_MIMES.has(mimeType)) try {
		const convertedBuffer = await convertBufferWithFfmpeg(file.buffer, inputExt, '.mp4',
			['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart'])
		return { ...file, name: `${baseName}.mp4`, mime_type: 'video/mp4', buffer: convertedBuffer }
	}
	catch (err) {
		console.error(`[SimpleWechat] 视频转换失败 ${fileName}:`, err)
	}

	return file
}

/**
 * 从 CDN 拉取密文并用 media.aes_key 解密。
 * @param {object} media CDN 媒体引用。
 * @param {string} cdnBaseUrl CDN 根地址。
 * @param {AbortSignal} signal 中止信号。
 * @returns {Promise<Buffer>} AES 解密后的媒体明文。
 */
async function downloadAndDecrypt(media, cdnBaseUrl, signal) {
	const encrypted = await downloadCdnBuffer(media.encrypt_query_param || '', cdnBaseUrl, media.full_url, signal)
	return decryptAesEcb(encrypted, parseInboundAesKey(media.aes_key))
}

/**
 * 下载并解密单条 MessageItem，供入站 chat_log.files 使用（对齐 openclaw media-download）。
 * @param {object} item item_list 元素。
 * @param {string} cdnBaseUrl CDN 根地址。
 * @param {AbortSignal} signal 中止信号。
 * @returns {Promise<{ name: string, buffer: Buffer, mime_type: string } | null>} 成功解析媒体时返回文件描述，否则为 null。
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
		console.error('[SimpleWechat] 入站媒体下载/解密失败:', err)
	}
	return null
}

/**
 * 合并连续的聊天日志条目。
 * 避免因冗余的每条消息条目而膨胀上下文。
 * @param {chatLogEntry_t_simple[]} log 聊天日志数组。
 * @returns {chatLogEntry_t_simple[]} 合并后的日志数组。
 */
function mergeChatLog(log) {
	if (!log?.length) return []
	const merged = []
	let last = null
	for (const entry of log) {
		const current = { ...entry }
		if (current.files) current.files = [...current.files]
		if (current.extension) current.extension = { ...current.extension }
		if (last && last.name === current.name && last.role === current.role &&
			current.time_stamp - last.time_stamp < 3 * 60000 && !last.files?.length) {
			last.content += '\n' + current.content
			last.time_stamp = current.time_stamp
			if (current.files?.length) last.files = [...last.files || [], ...current.files]
			if (current.extension?.wechat_message_id)
				last.extension = { ...last.extension, wechat_message_id: current.extension.wechat_message_id }
		}
		else {
			if (last) merged.push(last)
			last = current
		}
	}
	if (last) merged.push(last)
	return merged
}

/**
 * 深拷贝聊天日志条目（含文件 buffer），供 wechat_api.getChatLogs 安全返回。
 * @param {chatLogEntry_t_simple[]} entries 条目数组。
 * @returns {chatLogEntry_t_simple[]} 拷贝后的数组。
 */
function cloneChatLogEntries(entries) {
	return (entries || []).map(entry => ({
		...entry,
		files: (entry.files || []).map(filePart => ({
			...filePart,
			buffer: filePart.buffer ? Buffer.from(filePart.buffer) : undefined,
		})),
		extension: entry.extension ? { ...entry.extension } : undefined,
	}))
}

/**
 * @param {import('../../../../../../decl/charAPI.ts').CharAPI_t} charAPI 角色 API 实例。
 * @param {string} ownerUsername 所有者用户名。
 * @param {string} botCharname 机器人角色名。
 * @returns {{ OnceClientReady: Function, GetBotConfigTemplate: Function }} 微信接口实现。
 */
export function createSimpleWechatInterface(charAPI, ownerUsername, botCharname) {
	if (!charAPI?.interfaces?.chat?.GetReply)
		throw new Error('charAPI.interfaces.chat.GetReply is required for SimpleWechatInterface.')

	/**
	 * 获取默认机器人配置模板。
	 * @returns {{OwnerWeChatId: string, MaxMessageDepth: number}} 默认机器人配置模板。
	 */
	function GetSimpleBotConfigTemplate() {
		return {
			OwnerWeChatId: 'your_wechat_ilink_user_id',
			MaxMessageDepth: 40,
		}
	}

	/**
	 * 检测上传媒体类型。
	 * @param {{ name?: string, mime_type?: string }} fileLike 文件信息对象。
	 * @returns {number} 识别出的媒体类型。
	 */
	function detectUploadMediaType(fileLike) {
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
	 * 构建媒体消息项对象。
	 * @param {object} args 参数对象。
	 * @param {number} args.uploadMediaType 上传媒体类型。
	 * @param {any} {{ encrypt_query_param: string, aes_key: string }} args.media
	 * @param {any} {{ name?: string, buffer?: Buffer, mime_type?: string }} args.file
	 * @param {string} args.md5 文件 MD5。
	 * @param {number} args.fileSize 原始文件大小（字节）。
	 * @param {number} args.ciphertextSize 加密后文件大小（字节）。
	 * @returns {object} 构建后的媒体消息项对象。
	 */
	function buildMediaMessageItem(args) {
		/**
		 * @param {object} cdnMedia - CDN media 引用（与 @tencent-weixin/openclaw-weixin send.ts 一致）。
		 * @returns {object} 附带 encrypt_type 的发送侧 media 对象。
		 */
		const outboundMedia = cdnMedia => ({ ...cdnMedia, encrypt_type: 1 })

		if (args.uploadMediaType === UploadMediaType.IMAGE)
			return {
				type: MessageItemType.IMAGE,
				image_item: {
					media: outboundMedia(args.media),
					mid_size: args.ciphertextSize,
				},
			}

		if (args.uploadMediaType === UploadMediaType.VIDEO)
			return {
				type: MessageItemType.VIDEO,
				video_item: {
					media: outboundMedia(args.media),
					video_size: args.ciphertextSize,
				},
			}

		if (args.uploadMediaType === UploadMediaType.VOICE)
			return {
				type: MessageItemType.VOICE,
				voice_item: {
					media: outboundMedia(args.media),
				},
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
	 * 微信 Bot 主循环：长轮询拉取更新、去重入站消息并驱动回复，直至 ctx.signal 中止。
	 * @param {object} ctx 运行上下文。
	 * @param {() => Promise<any>} ctx.getUpdates 拉取消息更新的方法。
	 * @param {(body: object) => Promise<void>} ctx.sendMessage 发送消息的方法。
	 * @param {any} {(params: { mediaType: number, toUserId: string, fileBuffer: Buffer | Uint8Array | ArrayBuffer, cdnBaseUrl?: string }) => Promise<any>} ctx.uploadMedia
	 * @param {AbortSignal} ctx.signal 中止信号。
	 * @param {object} config 配置对象。
	 * @returns {Promise<void>}
	 */
	async function SimpleWechatBotMain(ctx, config) {
		const MAX_MESSAGE_DEPTH = config.MaxMessageDepth || 40
		const cdnBaseUrl = ctx.cdnBaseUrl || DEFAULT_WECHAT_ILINK_BASE
		/** 长轮询游标：服务端返回的 get_updates_buf，用于接续拉取。 */
		let getUpdatesCursor = ''
		let longPollTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS
		const chatLog = /** @type {chatLogEntry_t_simple[]} */ []
		let lastToUserId = ''
		let lastContextToken = ''
		const chatScopedCharMemory = {}
		const processedIds = new Set()
		let loggedReady = false

		/**
		 * 向指定微信用户发送文本（自动按长度分块）。
		 * @param {string} toUserId iLink 对端用户 ID。
		 * @param {string} contextToken 会话 context_token（可空字符串）。
		 * @param {string} text 文本。
		 * @returns {Promise<void>}
		 */
		async function sendWechatTextChunks(toUserId, contextToken, text) {
			const chunks = splitWechatText(text || '')
			for (const chunk of chunks) {
				if (!chunk.trim()) continue
				await ctx.sendMessage({
					msg: {
						from_user_id: '',
						to_user_id: toUserId,
						client_id: crypto.randomUUID(),
						message_type: MessageType.BOT,
						message_state: MessageState.FINISH,
						context_token: contextToken,
						item_list: [{ type: MessageItemType.TEXT, text_item: { text: chunk } }],
					},
				})
			}
		}

		/**
		 * 向指定用户发送多个附件（与 AI 回复链路相同的上传与 item_list 构造）。
		 * @param {string} toUserId iLink 对端用户 ID。
		 * @param {string} contextToken 会话 context_token。
		 * @param {any[]} fileList fount 文件对象列表。
		 * @returns {Promise<void>}
		 */
		async function sendWechatFilesToUser(toUserId, contextToken, fileList) {
			for (const rawFile of fileList || []) {
				if (!rawFile?.buffer) continue
				let file = rawFile
				try {
					file = await convertFileToWechatCompatible(rawFile)
					const uploadMediaType = detectUploadMediaType(file)
					const uploadResult = await ctx.uploadMedia({
						mediaType: uploadMediaType,
						toUserId,
						fileBuffer: file.buffer,
					})
					const messageItem = buildMediaMessageItem({
						uploadMediaType,
						media: uploadResult.media,
						file,
						md5: uploadResult.rawMd5,
						fileSize: uploadResult.rawSize,
						ciphertextSize: uploadResult.ciphertextSize,
					})
					await ctx.sendMessage({
						msg: {
							from_user_id: '',
							to_user_id: toUserId,
							client_id: crypto.randomUUID(),
							message_type: MessageType.BOT,
							message_state: MessageState.FINISH,
							context_token: contextToken,
							item_list: [messageItem],
						},
					})
				}
				catch (error) {
					console.error(`[SimpleWechat] 发送文件失败 ${file.name || 'unnamed'}:`, error)
				}
			}
		}

		/**
		 * 供代码执行调用的精简门面（与 plugins/wechat-api 对应）。
		 */
		const wechatApiFacade = {
			/** Bot 配置中的 OwnerWeChatId（iLink 用户 ID）。 */
			ownerWeChatId: config.OwnerWeChatId || '',
			/**
			 * Bot 内存中的微信聊天副本（单会话）。
			 * @returns {chatLogEntry_t_simple[]} 当前缓冲日志条目的深拷贝。
			 */
			getChatLogs: () => cloneChatLogEntries(chatLog),
			/**
			 * 发文本。默认发往最近一次入站用户，或配置中的 OwnerWeChatId。
			 * @param {string | { text: string, toUserId?: string, contextToken?: string }} textOrPayload 纯文本或含 text 与可选目标字段的对象。
			 * @returns {Promise<void>}
			 */
			sendText: async textOrPayload => {
				const payload = typeof textOrPayload === 'string' ? { text: textOrPayload } : textOrPayload || {}
				const toUserId = String(payload.toUserId || lastToUserId || config.OwnerWeChatId || '').trim()
				const contextToken = String(payload.contextToken ?? lastContextToken ?? '').trim()
				if (!toUserId)
					throw new Error('wechat_api.sendText: 需要配置 OwnerWeChatId，或先收到一条用户消息后再发')
				await sendWechatTextChunks(toUserId, contextToken, payload.text)
			},
			/**
			 * 发文件。默认目标同 sendText。
			 * @param {any[] | { files: any[], toUserId?: string, contextToken?: string }} filesOrPayload 文件数组或含 files 与可选目标字段的对象。
			 * @returns {Promise<void>}
			 */
			sendFiles: async filesOrPayload => {
				const payload = Array.isArray(filesOrPayload) ? { files: filesOrPayload } : filesOrPayload || {}
				const toUserId = String(payload.toUserId || lastToUserId || config.OwnerWeChatId || '').trim()
				const contextToken = String(payload.contextToken ?? lastContextToken ?? '').trim()
				if (!toUserId)
					throw new Error('wechat_api.sendFiles: 需要配置 OwnerWeChatId，或先收到一条用户消息后再发')
				await sendWechatFilesToUser(toUserId, contextToken, payload.files || [])
			},
		}

		charWechatRuntimeRegistry[ownerUsername] ??= {}
		charWechatRuntimeRegistry[ownerUsername][botCharname] = wechatApiFacade

		/**
		 * 追加一条日志并合并、截断深度。
		 * @param {chatLogEntry_t_simple} entry 日志条目。
		 */
		function appendToLog(entry) {
			chatLog.push(entry)
			const merged = mergeChatLog(chatLog)
			chatLog.length = 0
			chatLog.push(...merged)
			while (chatLog.length > MAX_MESSAGE_DEPTH)
				chatLog.shift()
		}

		/**
		 * @param {object} wxMsg 微信消息对象。
		 * @returns {Promise<chatLogEntry_t_simple>} 转换后的聊天日志条目。
		 */
		async function wechatMessageToEntry(wxMsg) {
			const text = extractInboundText(wxMsg)
			const fromId = wxMsg.from_user_id || ''
			const name = fromId
			const files = (await Promise.all(
				(wxMsg.item_list || []).map(item => downloadAndDecryptMediaItem(item, cdnBaseUrl, ctx.signal))
			)).filter(Boolean)
			return {
				time_stamp: wxMsg.create_time_ms ?? Date.now(),
				role: wxMsg.message_type === MessageType.BOT ? 'char' : 'user',
				name,
				content: text,
				files,
				extension: {
					wechat_message_id: String(wxMsg.message_id ?? wxMsg.seq ?? ''),
					wechat_context_token: wxMsg.context_token || '',
					wechat_from_user_id: wxMsg.from_user_id || '',
				},
			}
		}

		/**
		 * 对入站用户消息调用 GetReply，并将文本与附件发到微信。
		 * @param {object} wxMsg 微信消息对象。
		 * @returns {Promise<void>}
		 */
		async function doReply(wxMsg) {
			const text = extractInboundText(wxMsg)
			if (!text && !hasDownloadableMediaItem(wxMsg)) return

			const toUserId = wxMsg.from_user_id
			const contextToken = wxMsg.context_token || ''
			if (!toUserId) return

			/**
			 * 发送分割回复。
			 * @param {ChatReply_t} fountReply fount 聊天回复对象。
			 * @returns {Promise<void>}
			 */
			async function sendSplitReply(fountReply) {
				await sendWechatTextChunks(toUserId, contextToken, fountReply.content_for_show || fountReply.content || '')
				await sendWechatFilesToUser(toUserId, contextToken, fountReply.files || [])
			}

			try {
				/**
				 * 将角色回复追加到本地聊天日志（与 UserCharname / ReplyToCharname 的裸 ID 一致）。
				 * @param {ChatReply_t} fountReply fount 聊天回复对象。
				 * @returns {void}
				 */
				const appendCharReplyToLog = fountReply => {
					if (!fountReply || (!fountReply.content && !fountReply.files?.length)) return
					appendToLog({
						time_stamp: Date.now(),
						role: 'char',
						name: botCharname,
						content: fountReply.content_for_show || fountReply.content || '',
						files: fountReply.files?.length ? [...fountReply.files] : [],
						extension: {},
					})
				}

				/**
				 * 将角色回复下发到微信并追加到本地 chatLog（供 GetReply 链路的 add_message 使用）。
				 * @param {any} replyFromChar 角色回复对象。
				 * @returns {Promise<void>}
				 */
				const AddChatLogEntry = async replyFromChar => {
					if (replyFromChar && (replyFromChar.content || replyFromChar.files?.length)) {
						await sendSplitReply(replyFromChar)
						appendCharReplyToLog(replyFromChar)
					}
				}

				/**
				 * 生成聊天回复请求。
				 * @returns {Promise<object>} 聊天回复请求对象。
				 */
				const generateChatReplyRequest = async () => ({
					supported_functions: { markdown: true, files: true, add_message: true },
					username: ownerUsername,
					chat_name: 'WeChat',
					char_id: botCharname,
					Charname: botCharname,
					UserCharname: config.OwnerWeChatId || '',
					ReplyToCharname: toUserId,
					locales: localhostLocales,
					time: new Date(),
					world: null,
					user: await (async () => {
						const defaultPersonaName = getAnyPreferredDefaultPart(ownerUsername, 'personas')
						if (defaultPersonaName) return await loadPart(ownerUsername, 'personas/' + defaultPersonaName)
						return null
					})(),
					char: charAPI,
					other_chars: [],
					plugins: {},
					chat_scoped_char_memory: chatScopedCharMemory,
					chat_log: chatLog.map(e => ({ ...e })),
					AddChatLogEntry,
					/**
					 * 更新聊天回复请求。
					 * @returns {Promise<object>} 更新后的聊天回复请求对象。
					 */
					Update: async () => await generateChatReplyRequest(),
					extension: { platform: 'wechat', wechat_message: wxMsg },
				})

				await AddChatLogEntry(await charAPI.interfaces.chat.GetReply(await generateChatReplyRequest()))
			}
			catch (error) {
				console.error('[SimpleWechat] 回复失败:', error)
				try {
					await ctx.sendMessage({
						msg: {
							from_user_id: '',
							to_user_id: toUserId,
							client_id: crypto.randomUUID(),
							message_type: MessageType.BOT,
							message_state: MessageState.FINISH,
							context_token: contextToken,
							item_list: [{
								type: MessageItemType.TEXT,
								text_item: { text: `抱歉，回复出错：${error.message || '未知错误'}` },
							}],
						},
					})
				}
				catch { /* ignore send-error notification failure */ }
			}
		}

		try {
			while (!ctx.signal.aborted) {
				let resp
				try {
					resp = await ctx.getUpdates({ get_updates_buf: getUpdatesCursor, timeoutMs: longPollTimeoutMs })
				}
				catch (error) {
					if (ctx.signal.aborted) break
					console.error('[SimpleWechat] getUpdates 错误:', error)
					await new Promise(resolve => setTimeout(resolve, 2000))
					continue
				}

				if (ctx.signal.aborted) break

				if (resp?.errcode === -14)
					throw new Error('微信会话已失效（errcode -14），请重新完成渠道登录并更新 Token。')

				if (resp?.ret !== 0 && resp?.ret !== undefined) {
					console.error('[SimpleWechat] getUpdates 非成功 ret:', resp.ret, resp.errmsg)
					await new Promise(resolve => setTimeout(resolve, 2000))
					continue
				}

				if (resp?.get_updates_buf)
					getUpdatesCursor = resp.get_updates_buf

				if (resp?.longpolling_timeout_ms)
					longPollTimeoutMs = resp.longpolling_timeout_ms

				if (!loggedReady) {
					console.infoI18n('fountConsole.botStarted', {
						platform: 'WeChat',
						charname: botCharname,
						botusername: 'WeChat',
					})
					loggedReady = true
				}

				for (const msg of resp?.msgs || []) {
					const dedupKey = msg.message_id != null ? `m${msg.message_id}` : `s${msg.seq}:${msg.client_id || ''}`
					if (processedIds.has(dedupKey)) continue
					processedIds.add(dedupKey)

					if (msg.message_type !== MessageType.USER) continue
					if (msg.message_state === MessageState.GENERATING) continue

					const inboundText = extractInboundText(msg)
					if (!inboundText && !hasDownloadableMediaItem(msg)) continue

					const entry = await wechatMessageToEntry(msg)
					if (!entry) continue

					appendToLog(entry)
					if (msg.from_user_id)
						lastToUserId = msg.from_user_id
					lastContextToken = String(msg.context_token || '')

					await doReply(msg)
				}
			}
		}
		finally {
			if (charWechatRuntimeRegistry[ownerUsername]?.[botCharname] === wechatApiFacade) {
				delete charWechatRuntimeRegistry[ownerUsername][botCharname]
				if (!Object.keys(charWechatRuntimeRegistry[ownerUsername]).length)
					delete charWechatRuntimeRegistry[ownerUsername]
			}
		}
	}

	return {
		/**
		 * 启动微信 Bot 主循环。
		 * @param {object} ctx 运行上下文。
		 * @param {object} config 配置对象。
		 * @returns {Promise<void>}
		 */
		OnceClientReady: async (ctx, config) => {
			SimpleWechatBotMain(ctx, config)
		},
		GetBotConfigTemplate: GetSimpleBotConfigTemplate,
	}
}
