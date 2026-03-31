import { Buffer } from 'node:buffer'

import { localhostLocales, console } from '../../../../../../scripts/i18n.mjs'
import { getAnyPreferredDefaultPart, loadPart } from '../../../../../../server/parts_loader.mjs'
import { splitDiscordReply } from '../../../discordbot/src/default_interface/tools.mjs'
import { DEFAULT_LONG_POLL_TIMEOUT_MS, UploadMediaType } from '../weixin_api.mjs'

/** @typedef {import('../../../chat/decl/chatLog.ts').chatReply_t} ChatReply_t */
/** @typedef {import('../../../chat/decl/chatLog.ts').chatLogEntry_t} FountChatLogEntryBase */
/** @typedef {FountChatLogEntryBase & { extension?: { weixin_message_id?: string, [key: string]: any } }} chatLogEntry_t_simple */

const MessageType = { USER: 1, BOT: 2 }
const MessageItemType = { TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 }
const MessageState = { NEW: 0, GENERATING: 1, FINISH: 2 }

const IMAGE_NAME_REGEXP = /\.(jpeg|jpg|png|gif|webp|bmp)$/i
const VIDEO_NAME_REGEXP = /\.(mp4|mov|avi|mkv|webm)$/i
const AUDIO_NAME_REGEXP = /\.(mp3|ogg|wav|m4a|aac|flac)$/i

/**
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
 * Merges consecutive chat log entries from the same sender within 3 minutes into one.
 * Avoids inflating context with redundant per-message entries.
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
	 *
 * @returns {any} 返回值。
	 */
	function GetSimpleBotConfigTemplate() {
		return {
			OwnerWeChatId: 'your_wechat_ilink_user_id',
			MaxMessageDepth: 40,
			ReplyToAllMessages: false,
		}
	}

	/**
	 * @param {{ name?: string, mime_type?: string }} fileLike 文件信息对象。
 * @returns {any} 默认机器人配置模板。
	 */
	function detectUploadMediaType(fileLike) {
		const mimeType = String(fileLike?.mime_type || '').toLowerCase()
		const fileName = String(fileLike?.name || '').toLowerCase()
		if (mimeType.startsWith('image/') || IMAGE_NAME_REGEXP.test(fileName))
			return UploadMediaType.IMAGE
		if (mimeType.startsWith('video/') || VIDEO_NAME_REGEXP.test(fileName))
			return UploadMediaType.VIDEO
		if (mimeType.startsWith('audio/') || AUDIO_NAME_REGEXP.test(fileName))
			return UploadMediaType.VOICE
		return UploadMediaType.FILE
	}

	/**
	 * @param {object} args 参数数组。
	 * @param {number} args.uploadMediaType 上传媒体类型。
	 * @param {any} {{ encrypt_query_param: string, aes_key: string }} args.media
	 * @param {any} {{ name?: string, buffer?: Buffer, mime_type?: string }} args.file
	 * @param {string} args.md5 文件 MD5。
	 * @param {number} args.fileSize 原始文件大小（字节）。
	 * @param {number} args.ciphertextSize 加密后文件大小（字节）。
 * @returns {any} 识别出的媒体类型。
	 */
	function buildMediaMessageItem(args) {
		if (args.uploadMediaType === UploadMediaType.IMAGE) 
			return {
				type: MessageItemType.IMAGE,
				image_item: {
					media: args.media,
					aeskey: Buffer.from(args.media.aes_key, 'base64').toString('hex'),
					hd_size: args.ciphertextSize,
					mid_size: args.ciphertextSize,
				},
			}
		
		if (args.uploadMediaType === UploadMediaType.VIDEO) 
			return {
				type: MessageItemType.VIDEO,
				video_item: {
					media: args.media,
					video_size: args.ciphertextSize,
					video_md5: args.md5,
				},
			}
		
		if (args.uploadMediaType === UploadMediaType.VOICE) 
			return {
				type: MessageItemType.VOICE,
				voice_item: {
					media: args.media,
				},
			}
		
		return {
			type: MessageItemType.FILE,
			file_item: {
				media: args.media,
				file_name: args.file.name || 'file',
				md5: args.md5,
				len: String(args.fileSize),
			},
		}
	}

	/**
	 * @param {object} ctx 运行上下文。
	 * @param {() => Promise<any>} ctx.getUpdates 拉取消息更新的方法。
	 * @param {(body: object) => Promise<void>} ctx.sendMessage 发送消息的方法。
	 * @param {any} {(params: { mediaType: number, toUserId: string, fileBuffer: Buffer | Uint8Array | ArrayBuffer, cdnBaseUrl?: string }) => Promise<any>} ctx.uploadMedia
	 * @param {AbortSignal} ctx.signal 中止信号。
	 * @param {object} config 配置对象。
 * @returns {Promise<any>} 可发送的消息项对象。
	 */
	async function SimpleWeixinBotMain(ctx, config) {
		const MAX_MESSAGE_DEPTH = config.MaxMessageDepth || 40
		let buf = ''
		let longPollTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS
		const chatLogs = /** @type {Record<string, chatLogEntry_t_simple[]>} */ {}
		const chatScopedCharMemory = {}
		const processedIds = new Set()
		let loggedReady = false

		/**
		 * @param {object} wxMsg 微信消息对象。
		 * @returns {chatLogEntry_t_simple} 转换后的聊天日志条目。
		 */
		function weixinMessageToEntry(wxMsg) {
			const text = extractInboundText(wxMsg)
			const fromId = wxMsg.from_user_id || ''
			const name = `peer:${fromId.slice(0, 12)}`
			return {
				time_stamp: wxMsg.create_time_ms ?? Date.now(),
				role: wxMsg.message_type === MessageType.BOT ? 'char' : 'user',
				name,
				content: text,
				files: [],
				extension: { weixin_message_id: String(wxMsg.message_id ?? wxMsg.seq ?? '') },
			}
		}

		/**
		 * @param {object} wxMsg 微信消息对象。
		 * @param {string} peerKey 会话对端标识。
 * @returns {Promise<any>} 转换后的聊天日志条目。
		 */
		async function doReply(wxMsg, peerKey) {
			const text = extractInboundText(wxMsg)
			if (!text) return

			const toUserId = wxMsg.from_user_id
			const contextToken = wxMsg.context_token || ''
			if (!toUserId) return

			/**
			 *
			 * @param {any} text 文本内容。
 * @returns {Promise<any>} 返回值。
			 */
			async function sendTextChunks(text) {
				const chunks = splitDiscordReply(text || '', 2000)
				for (const chunk of chunks) {
					if (!chunk.trim()) continue
					await ctx.sendMessage({
						msg: {
							to_user_id: toUserId,
							context_token: contextToken,
							item_list: [{ type: MessageItemType.TEXT, text_item: { text: chunk } }],
						},
					})
				}
			}

			/**
			 * @param {ChatReply_t} fountReply Fount 回复对象。
 * @returns {Promise<any>} 返回值。
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
								to_user_id: toUserId,
								context_token: contextToken,
								item_list: [messageItem],
							},
						})
					}
						catch (error) {
						console.error(`[SimpleWeixin] 发送文件失败 ${file.name || 'unnamed'}:`, error)
						await sendTextChunks(`[文件发送失败: ${file.name || 'unnamed'}]`)
					}
				}
			}

			try {
				/**
				 *
				 * @param {any} replyFromChar 角色回复对象。
 * @returns {Promise<any>} 返回值。
				 */
				const AddChatLogEntry = async replyFromChar => {
					if (replyFromChar && (replyFromChar.content || replyFromChar.files?.length))
						await sendSplitReply(replyFromChar)

					return null
				}

				const peerDisplay = `peer:${(wxMsg.from_user_id || '').slice(0, 16)}`

				/**
				 *
 * @returns {Promise<any>} 返回值。
				 */
				const generateChatReplyRequest = async () => ({
					supported_functions: { markdown: true, files: true, add_message: true },
					username: ownerUsername,
					chat_name: `WeChat ${peerKey}`,
					char_id: botCharname,
					Charname: botCharname,
					UserCharname: config.OwnerWeChatId || '',
					ReplyToCharname: peerDisplay,
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
					 *
 * @returns {Promise<any>} 返回值。
					 */
					Update: async () => await generateChatReplyRequest(),
					extension: { platform: 'weixin', peer_key: peerKey, weixin_message: wxMsg },
				})

				const aiFinalReply = await charAPI.interfaces.chat.GetReply(await generateChatReplyRequest())
				if (aiFinalReply && (aiFinalReply.content || aiFinalReply.files?.length))
					await sendSplitReply(aiFinalReply)
			}
			catch (error) {
				console.error(`[SimpleWeixin] 回复失败 peer=${peerKey}:`, error)
				try {
					await ctx.sendMessage({
						msg: {
							to_user_id: toUserId,
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

			if (resp?.get_updates_buf !== undefined)
				buf = resp.get_updates_buf

			if (resp?.longpolling_timeout_ms)
				longPollTimeoutMs = resp.longpolling_timeout_ms

			if (!loggedReady) {
				console.infoI18n('fountConsole.weixinbot.botStarted', {
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
				if (!inboundText) continue

				const peerKey = msg.session_id || msg.from_user_id || 'unknown'
				const entry = weixinMessageToEntry(msg)
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
		 * @param {object} ctx 运行上下文。
		 * @param {object} config 配置对象。
 * @returns {Promise<any>} 返回值。
		 */
		OnceClientReady: async (ctx, config) => {
			await SimpleWeixinBotMain(ctx, config)
		},
		GetBotConfigTemplate: GetSimpleBotConfigTemplate,
	}
}
