import { Buffer } from 'node:buffer'

import { localhostLocales, console } from '../../../../../../scripts/i18n.mjs'
import { getAnyPreferredDefaultPart, loadPart } from '../../../../../../server/parts_loader.mjs'
import { splitDiscordReply } from '../../../discordbot/src/default_interface/tools.mjs'
import {
	DEFAULT_LONG_POLL_TIMEOUT_MS,
	DEFAULT_WEIXIN_ILINK_BASE,
	UploadMediaType,
	decryptAesEcb,
	downloadCdnBuffer,
	parseInboundAesKey,
} from '../weixin_api.mjs'

/** @typedef {import('../../../chat/decl/chatLog.ts').chatReply_t} ChatReply_t */
/** @typedef {import('../../../chat/decl/chatLog.ts').chatLogEntry_t} FountChatLogEntryBase */
/** @typedef {FountChatLogEntryBase & { extension?: { weixin_message_id?: string, [key: string]: any } }} chatLogEntry_t_simple */

const MessageType = { USER: 1, BOT: 2 }
const MessageItemType = { TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 }
const MessageState = { NEW: 0, GENERATING: 1, FINISH: 2 }

const IMAGE_NAME_REGEXP = /\.(jpeg|jpg|png|gif|webp|bmp)$/i
/** 微信 CDN media_type=IMAGE 不接受这些格式，需回退为 FILE 附件。 */
const WEIXIN_UNSUPPORTED_IMAGE_MIMES = new Set(['image/avif', 'image/heic', 'image/heif', 'image/jxl'])
const WEIXIN_UNSUPPORTED_IMAGE_EXT_REGEXP = /\.(avif|heic|heif|jxl)$/i
const VIDEO_NAME_REGEXP = /\.(mp4|mov|avi|mkv|webm)$/i
const AUDIO_NAME_REGEXP = /\.(mp3|ogg|wav|m4a|aac|flac)$/i

/**
 * 提取微信消息的文本内容。
 * @param {object} msg 微信消息对象。
 * @returns {string} 拼接后的文本内容，无文本时返回空字符串。
 */
function extractInboundText(msg) {
	const parts = []
	for (const item of msg.item_list || [])
		if (item.type === MessageItemType.TEXT && item.text_item?.text)
			parts.push(item.text_item.text)

	return parts.join('\n').trim()
}

/**
 * 判断消息是否包含可从 CDN 拉取的媒体项。
 * @param {object} msg 微信消息对象。
 * @returns {boolean}
 */
function hasDownloadableMediaItem(msg) {
	for (const item of msg.item_list || []) {
		const m = item.image_item?.media || item.file_item?.media || item.video_item?.media || item.voice_item?.media
		if (m && (m.encrypt_query_param || m.full_url))
			return true
	}
	return false
}

/**
 * 根据文件名猜测 MIME。
 * @param {string} name 文件名。
 * @returns {string}
 */
function guessMimeFromFileName(name) {
	const n = String(name).toLowerCase()
	if (/\.(jpe?g)$/.test(n)) return 'image/jpeg'
	if (/\.png$/.test(n)) return 'image/png'
	if (/\.gif$/.test(n)) return 'image/gif'
	if (/\.webp$/.test(n)) return 'image/webp'
	if (/\.(mp4|m4v)$/.test(n)) return 'video/mp4'
	if (/\.(mp3|m4a)$/.test(n)) return 'audio/mpeg'
	if (/\.wav$/.test(n)) return 'audio/wav'
	return 'application/octet-stream'
}

/**
 * 下载并解密单条 MessageItem，供入站 chat_log.files 使用（对齐 openclaw media-download）。
 * @param {object} item item_list 元素。
 * @param {string} cdnBaseUrl CDN 根地址。
 * @param {AbortSignal} signal 中止信号。
 * @returns {Promise<{ name: string, buffer: Buffer, mime_type: string } | null>}
 */
async function downloadAndDecryptMediaItem(item, cdnBaseUrl, signal) {
	try {
		if (item.type === MessageItemType.IMAGE) {
			const img = item.image_item
			const media = img?.media
			if (!media || (!media.encrypt_query_param && !media.full_url)) return null
			const hexKey = img.aeskey && /^[0-9a-fA-F]{32}$/i.test(String(img.aeskey).trim())
				? String(img.aeskey).trim()
				: ''
			const aesKeyBase64 = hexKey
				? Buffer.from(hexKey, 'hex').toString('base64')
				: media.aes_key
			const encrypted = await downloadCdnBuffer(media.encrypt_query_param || '', cdnBaseUrl, media.full_url, signal)
			const buf = aesKeyBase64
				? decryptAesEcb(encrypted, parseInboundAesKey(aesKeyBase64))
				: encrypted
			return { name: 'weixin_image.bin', buffer: buf, mime_type: 'image/jpeg' }
		}

		if (item.type === MessageItemType.FILE) {
			const fi = item.file_item
			const media = fi?.media
			if (!media?.aes_key || (!media.encrypt_query_param && !media.full_url)) return null
			const encrypted = await downloadCdnBuffer(media.encrypt_query_param || '', cdnBaseUrl, media.full_url, signal)
			const buf = decryptAesEcb(encrypted, parseInboundAesKey(media.aes_key))
			const name = fi.file_name || 'file.bin'
			return { name, buffer: buf, mime_type: guessMimeFromFileName(name) }
		}

		if (item.type === MessageItemType.VIDEO) {
			const vi = item.video_item
			const media = vi?.media
			if (!media?.aes_key || (!media.encrypt_query_param && !media.full_url)) return null
			const encrypted = await downloadCdnBuffer(media.encrypt_query_param || '', cdnBaseUrl, media.full_url, signal)
			const buf = decryptAesEcb(encrypted, parseInboundAesKey(media.aes_key))
			return { name: 'weixin_video.mp4', buffer: buf, mime_type: 'video/mp4' }
		}

		if (item.type === MessageItemType.VOICE) {
			const vo = item.voice_item
			if (vo?.text) return null
			const media = vo?.media
			if (!media?.aes_key || (!media.encrypt_query_param && !media.full_url)) return null
			const encrypted = await downloadCdnBuffer(media.encrypt_query_param || '', cdnBaseUrl, media.full_url, signal)
			const buf = decryptAesEcb(encrypted, parseInboundAesKey(media.aes_key))
			return { name: 'weixin_voice.silk', buffer: buf, mime_type: 'application/octet-stream' }
		}
	}
	catch (err) {
		console.error('[SimpleWeixin] 入站媒体下载/解密失败:', err)
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
			if (current.extension?.weixin_message_id)
				last.extension = { ...last.extension, weixin_message_id: current.extension.weixin_message_id }
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
 * @param {import('../../../../../../decl/charAPI.ts').CharAPI_t} charAPI 角色 API 实例。
 * @param {string} ownerUsername 所有者用户名。
 * @param {string} botCharname 机器人角色名。
 * @returns {{ OnceClientReady: Function, GetBotConfigTemplate: Function }} 微信接口实现。
 */
export function createSimpleWeixinInterface(charAPI, ownerUsername, botCharname) {
	if (!charAPI?.interfaces?.chat?.GetReply)
		throw new Error('charAPI.interfaces.chat.GetReply is required for SimpleWeixinInterface.')

	/**
	 * 获取默认机器人配置模板。
	 * @returns {{OwnerWeChatId: string, MaxMessageDepth: number, ReplyToAllMessages: boolean}} 默认机器人配置模板。
	 */
	function GetSimpleBotConfigTemplate() {
		return {
			OwnerWeChatId: 'your_wechat_ilink_user_id',
			MaxMessageDepth: 40,
			ReplyToAllMessages: false,
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
		if ((mimeType.startsWith('image/') && !WEIXIN_UNSUPPORTED_IMAGE_MIMES.has(mimeType)) ||
			(IMAGE_NAME_REGEXP.test(fileName) && !WEIXIN_UNSUPPORTED_IMAGE_EXT_REGEXP.test(fileName)))
			return UploadMediaType.IMAGE
		if (mimeType.startsWith('video/') || VIDEO_NAME_REGEXP.test(fileName))
			return UploadMediaType.VIDEO
		if (mimeType.startsWith('audio/') || AUDIO_NAME_REGEXP.test(fileName))
			return UploadMediaType.VOICE
		return UploadMediaType.FILE
	}

	/**
	 * 构建媒体消息项对象。
	 * @param {object} args 参数数组。
	 * @param {number} args.uploadMediaType 上传媒体类型。
	 * @param {any} {{ encrypt_query_param: string, aes_key: string }} args.media
	 * @param {any} {{ name?: string, buffer?: Buffer, mime_type?: string }} args.file
	 * @param {string} args.md5 文件 MD5。
	 * @param {number} args.fileSize 原始文件大小（字节）。
	 * @param {number} args.ciphertextSize 加密后文件大小（字节）。
	 * @returns {object} 构建后的媒体消息项对象。
	 */
	function buildMediaMessageItem(args) {
		/** @param {object} m CDN media 引用（与 @tencent-weixin/openclaw-weixin send.ts 一致）。 */
		const outboundMedia = m => ({ ...m, encrypt_type: 1 })

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
	 * 主函数，初始化微信客户端。
	 * @param {object} ctx 运行上下文。
	 * @param {() => Promise<any>} ctx.getUpdates 拉取消息更新的方法。
	 * @param {(body: object) => Promise<void>} ctx.sendMessage 发送消息的方法。
	 * @param {any} {(params: { mediaType: number, toUserId: string, fileBuffer: Buffer | Uint8Array | ArrayBuffer, cdnBaseUrl?: string }) => Promise<any>} ctx.uploadMedia
	 * @param {AbortSignal} ctx.signal 中止信号。
	 * @param {object} config 配置对象。
	 * @returns {Promise<void>}
	 */
	async function SimpleWeixinBotMain(ctx, config) {
		const MAX_MESSAGE_DEPTH = config.MaxMessageDepth || 40
		const cdnBaseUrl = ctx.cdnBaseUrl || DEFAULT_WEIXIN_ILINK_BASE
		let buf = ''
		let longPollTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS
		const chatLogs = /** @type {Record<string, chatLogEntry_t_simple[]>} */ {}
		const chatScopedCharMemory = {}
		const processedIds = new Set()
		let loggedReady = false

		/**
		 * @param {object} wxMsg 微信消息对象。
		 * @returns {Promise<chatLogEntry_t_simple>} 转换后的聊天日志条目。
		 */
		async function weixinMessageToEntry(wxMsg) {
			const text = extractInboundText(wxMsg)
			const fromId = wxMsg.from_user_id || ''
			const name = fromId
			const files = []
			for (const item of wxMsg.item_list || []) {
				const f = await downloadAndDecryptMediaItem(item, cdnBaseUrl, ctx.signal)
				if (f) files.push(f)
			}
			return {
				time_stamp: wxMsg.create_time_ms ?? Date.now(),
				role: wxMsg.message_type === MessageType.BOT ? 'char' : 'user',
				name,
				content: text,
				files,
				extension: { weixin_message_id: String(wxMsg.message_id ?? wxMsg.seq ?? '') },
			}
		}

		/**
		 * 处理微信消息回复。
		 * @param {object} wxMsg 微信消息对象。
		 * @param {string} peerKey 会话对端标识。
		 * @returns {Promise<void>}
		 */
		async function doReply(wxMsg, peerKey) {
			const text = extractInboundText(wxMsg)
			if (!text && !hasDownloadableMediaItem(wxMsg)) return

			const toUserId = wxMsg.from_user_id
			const contextToken = wxMsg.context_token || ''
			if (!toUserId) return

			/**
			 * 发送文本分块。
			 * @param {any} text 文本内容。
			 * @returns {Promise<void>}
			 */
			async function sendTextChunks(text) {
				const chunks = splitDiscordReply(text || '', 2000)
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
			 * 发送分割回复。
			 * @param {ChatReply_t} fountReply fount 聊天回复对象。
			 * @returns {Promise<void>}
			 */
			async function sendSplitReply(fountReply) {
				await sendTextChunks(fountReply.content_for_show || fountReply.content || '')

				for (const file of fountReply.files || []) {
					if (!file?.buffer) continue
					try {
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
						console.error(`[SimpleWeixin] 发送文件失败 ${file.name || 'unnamed'}:`, error)
					}
				}
			}

			try {
				/**
				 * 将角色回复追加到本地聊天日志（与 UserCharname / ReplyToCharname 的裸 ID 一致）。
				 * @param {ChatReply_t} fountReply fount 聊天回复对象。
				 * @returns {void}
				 */
				const appendCharReplyToLog = fountReply => {
					if (!fountReply || (!fountReply.content && !fountReply.files?.length)) return
					if (!chatLogs[peerKey]) chatLogs[peerKey] = []
					const show = fountReply.content_for_show || fountReply.content || ''
					chatLogs[peerKey].push({
						time_stamp: Date.now(),
						role: 'char',
						name: botCharname,
						content: show,
						files: fountReply.files?.length ? [...fountReply.files] : [],
						extension: {},
					})
					chatLogs[peerKey] = mergeChatLog(chatLogs[peerKey])
					while (chatLogs[peerKey].length > MAX_MESSAGE_DEPTH)
						chatLogs[peerKey].shift()
				}

				/**
				 * 添加聊天日志条目。
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
					chat_name: `WeChat ${peerKey}`,
					char_id: botCharname,
					Charname: botCharname,
					UserCharname: config.OwnerWeChatId || '',
					ReplyToCharname: toUserId,
					locales: localhostLocales,
					time: new Date(),
					world: null,
					user: await (async () => {
						const n = getAnyPreferredDefaultPart(ownerUsername, 'personas')
						if (n) return await loadPart(ownerUsername, 'personas/' + n)
						return null
					})(),
					char: charAPI,
					other_chars: [],
					plugins: {},
					chat_scoped_char_memory: chatScopedCharMemory,
					chat_log: (chatLogs[peerKey] || []).map(e => ({ ...e })),
					AddChatLogEntry,
					/**
					 * 更新聊天回复请求。
					 * @returns {Promise<object>} 更新后的聊天回复请求对象。
					 */
					Update: async () => await generateChatReplyRequest(),
					extension: { platform: 'weixin', peer_key: peerKey, weixin_message: wxMsg },
				})

				const aiFinalReply = await charAPI.interfaces.chat.GetReply(await generateChatReplyRequest())
				if (aiFinalReply && (aiFinalReply.content || aiFinalReply.files?.length)) {
					await sendSplitReply(aiFinalReply)
					appendCharReplyToLog(aiFinalReply)
				}
			}
			catch (error) {
				console.error(`[SimpleWeixin] 回复失败 peer=${peerKey}:`, error)
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

		while (!ctx.signal.aborted) {
			let resp
			try {
				resp = await ctx.getUpdates({ get_updates_buf: buf, timeoutMs: longPollTimeoutMs })
			}
			catch (error) {
				if (ctx.signal.aborted) break
				console.error('[SimpleWeixin] getUpdates 错误:', error)
				await new Promise(resolve => setTimeout(resolve, 2000))
				continue
			}

			if (ctx.signal.aborted) break

			if (resp?.errcode === -14)
				throw new Error('微信会话已失效（errcode -14），请重新完成渠道登录并更新 Token。')

			if (resp?.ret !== 0 && resp?.ret !== undefined) {
				console.error('[SimpleWeixin] getUpdates 非成功 ret:', resp.ret, resp.errmsg)
				await new Promise(resolve => setTimeout(resolve, 2000))
				continue
			}

			if (resp?.get_updates_buf)
				buf = resp.get_updates_buf

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

				const peerKey = msg.session_id || msg.from_user_id || 'unknown'
				const entry = await weixinMessageToEntry(msg)
				if (!entry) continue

				if (!chatLogs[peerKey]) chatLogs[peerKey] = []
				chatLogs[peerKey].push(entry)
				chatLogs[peerKey] = mergeChatLog(chatLogs[peerKey])
				while (chatLogs[peerKey].length > MAX_MESSAGE_DEPTH)
					chatLogs[peerKey].shift()

				const shouldReply = config.ReplyToAllMessages ||
					(config.OwnerWeChatId && msg.from_user_id === config.OwnerWeChatId)

				if (shouldReply)
					await doReply(msg, peerKey)
			}
		}
	}

	return {
		/**
		 * 初始化微信客户端。
		 * @param {object} ctx 运行上下文。
		 * @param {object} config 配置对象。
		 * @returns {Promise<void>} 返回值。
		 */
		OnceClientReady: async (ctx, config) => {
			await SimpleWeixinBotMain(ctx, config)
		},
		GetBotConfigTemplate: GetSimpleBotConfigTemplate,
	}
}
