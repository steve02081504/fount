import { console } from '../../../../../scripts/i18n/bare.mjs'

import {
	buildWechatMediaMessageItem,
	convertFileToWechatCompatible,
	detectWechatUploadMediaType,
	splitWechatText,
	WechatMessageItemType,
	WechatMessageState,
	WechatMessageType,
	wechatMessageHasContent,
	wechatMessageToBridgeDto,
} from './format.mjs'
import { DEFAULT_LONG_POLL_TIMEOUT_MS, DEFAULT_WECHAT_ILINK_BASE } from './wechat_api.mjs'

/**
 * @typedef {import('../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t
 */

/** @type {Record<string, Record<string, object>>} */
const charWechatRuntimeRegistry = {}

/**
 * @param {string} username replica
 * @param {string} charname 角色名
 * @returns {object | undefined}
 */
export function getWechatRuntimeForChar(username, charname) {
	return charWechatRuntimeRegistry[username]?.[charname]
}

/**
 * @param {object} messageLine DAG 消息行
 * @param {string} charname 角色名
 * @returns {object}
 */
function messageLineToReplyEntry(messageLine, charname) {
	const content = messageLine?.content || {}
	return {
		name: charname,
		role: 'char',
		content: typeof content === 'string' ? content : content.text || '',
		content_for_show: typeof content === 'string' ? content : content.text || '',
		time_stamp: messageLine?.hlc?.wall || Date.now(),
		files: (messageLine?.files || []).map(file => ({
			name: file.name,
			mime_type: file.mime_type,
			buffer: file.buffer,
			description: file.description || '',
		})),
		extension: { dagEventId: messageLine?.eventId },
	}
}

/**
 * @param {CharAPI_t} charAPI 角色 API
 * @param {string} ownerUsername replica
 * @param {string} botCharname 角色名
 * @returns {{ OnceClientReady: Function, GetBotConfigTemplate: Function }}
 */
export function createSimpleWechatInterface(charAPI, ownerUsername, botCharname) {
	/**
	 *
	 */
	function GetSimpleBotConfigTemplate() {
		return {
			OwnerWeChatId: 'your_wechat_ilink_user_id',
			OwnerPromptName: '',
		}
	}

	/**
	 * @param {object} context 运行上下文
	 * @param {object} interfaceConfig 配置
	 */
	async function SimpleWechatBotMain(context, interfaceConfig) {
		const { registerBridgeOps } = await import('../../chat/src/chat/bridge/ops.mjs')
		const { postBridgeMessage } = await import('../../chat/src/chat/bridge/ingress.mjs')
		const { registerBridgeOutbound } = await import('../../chat/src/chat/bridge/outbound.mjs')
		const { listBridgeGroupMappings } = await import('../../chat/src/chat/bridge/registry.mjs')
		const { channelMessageAgentText } = await import('../../chat/public/shared/channelContent.mjs')

		const cdnBaseUrl = context.cdnBaseUrl || DEFAULT_WECHAT_ILINK_BASE
		const ownerDisplayName = String(interfaceConfig.OwnerPromptName ?? '').trim() || ownerUsername
		let getUpdatesCursor = ''
		let longPollTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS
		let lastToUserId = String(interfaceConfig.OwnerWeChatId || '').trim()
		let lastContextToken = ''
		const processedIds = new Set()
		let loggedReady = false
		/** @type {Set<string>} */
		const outboundRegistered = new Set()

		registerBridgeOps('wechat', {
			/**
			 *
			 * @param root0
			 * @param root0.platformChatId
			 */
			sendTyping: async ({ platformChatId }) => {
				await context.sendTyping({
					to_user_id: String(platformChatId),
					context_token: lastContextToken,
				})
			},
			/**
			 *
			 * @param root0
			 * @param root0.platformChatId
			 */
			getNativeContext: async ({ platformChatId }) => ({
				wechat_api: charWechatRuntimeRegistry[ownerUsername]?.[botCharname],
				platformChatId,
			}),
		})

		/**
		 * @param {string} toUserId 对端 ID
		 * @param {string} contextToken 会话 token
		 * @param {string} text 文本
		 */
		async function sendWechatTextChunks(toUserId, contextToken, text) {
			for (const chunk of splitWechatText(text || '')) {
				if (!chunk.trim()) continue
				await context.sendMessage({
					msg: {
						from_user_id: '',
						to_user_id: toUserId,
						client_id: crypto.randomUUID(),
						message_type: WechatMessageType.BOT,
						message_state: WechatMessageState.FINISH,
						context_token: contextToken,
						item_list: [{ type: WechatMessageItemType.TEXT, text_item: { text: chunk } }],
					},
				})
			}
		}

		/**
		 * @param {string} toUserId 对端 ID
		 * @param {string} contextToken 会话 token
		 * @param {any[]} fileList 文件列表
		 */
		async function sendWechatFilesToUser(toUserId, contextToken, fileList) {
			for (const rawFile of fileList || []) {
				if (!rawFile?.buffer) continue
				const file = await convertFileToWechatCompatible(rawFile)
				const uploadMediaType = detectWechatUploadMediaType(file)
				const uploadResult = await context.uploadMedia({
					mediaType: uploadMediaType,
					toUserId,
					fileBuffer: file.buffer,
				})
				const messageItem = buildWechatMediaMessageItem({
					uploadMediaType,
					media: uploadResult.media,
					file,
					fileSize: uploadResult.rawSize,
					ciphertextSize: uploadResult.ciphertextSize,
				})
				await context.sendMessage({
					msg: {
						from_user_id: '',
						to_user_id: toUserId,
						client_id: crypto.randomUUID(),
						message_type: WechatMessageType.BOT,
						message_state: WechatMessageState.FINISH,
						context_token: contextToken,
						item_list: [messageItem],
					},
				})
			}
		}

		const wechatApiFacade = {
			ownerWeChatId: interfaceConfig.OwnerWeChatId || '',
			/**
			 *
			 */
			getChatLogs: () => [],
			/**
			 *
			 * @param textOrPayload
			 */
			sendText: async textOrPayload => {
				const payload = typeof textOrPayload === 'string' ? { text: textOrPayload } : textOrPayload || {}
				const toUserId = String(payload.toUserId || lastToUserId || '').trim()
				const contextToken = String(payload.contextToken ?? lastContextToken ?? '').trim()
				if (!toUserId) throw new Error('wechat_api.sendText: 需要 OwnerWeChatId 或先入站消息')
				await sendWechatTextChunks(toUserId, contextToken, payload.text)
			},
			/**
			 *
			 * @param filesOrPayload
			 */
			sendFiles: async filesOrPayload => {
				const payload = Array.isArray(filesOrPayload) ? { files: filesOrPayload } : filesOrPayload || {}
				const toUserId = String(payload.toUserId || lastToUserId || '').trim()
				const contextToken = String(payload.contextToken ?? lastContextToken ?? '').trim()
				if (!toUserId) throw new Error('wechat_api.sendFiles: 需要 OwnerWeChatId 或先入站消息')
				await sendWechatFilesToUser(toUserId, contextToken, payload.files || [])
			},
		}

		charWechatRuntimeRegistry[ownerUsername] ??= {}
		charWechatRuntimeRegistry[ownerUsername][botCharname] = wechatApiFacade

		/**
		 * @param {string} groupId 群 ID
		 * @param {object} bridge 桥接设置
		 */
		async function ensureOutboundHandler(groupId, bridge) {
			if (outboundRegistered.has(groupId)) return
			registerBridgeOutbound(ownerUsername, groupId, async ({ messageLine }) => {
				const toUserId = String(bridge.platformChatId || lastToUserId || '').trim()
				if (!toUserId) return {}
				const contextToken = lastContextToken
				const rawText = channelMessageAgentText(messageLine.content) || ''
				const replyEntry = messageLineToReplyEntry(messageLine, botCharname)
				const files = (messageLine.files || []).map(file => ({
					name: file.name,
					buffer: file.buffer,
					mime_type: file.mime_type,
				}))

				/**
				 *
				 * @param payload
				 */
				const sendPayload = async payload => {
					if (payload.text != null)
						await sendWechatTextChunks(toUserId, contextToken, payload.text)
					if (payload.files?.length)
						await sendWechatFilesToUser(toUserId, contextToken, payload.files)
					return { platformMessageId: crypto.randomUUID() }
				}

				const handled = await charAPI.interfaces.wechat?.FormatOutboundReply?.(replyEntry, {
					platform: 'wechat',
					send: sendPayload,
					chatId: toUserId,
				})
				if (handled) return {}

				if (rawText.trim())
					await sendWechatTextChunks(toUserId, contextToken, rawText)
				if (files.length)
					await sendWechatFilesToUser(toUserId, contextToken, files)
				return {}
			})
			outboundRegistered.add(groupId)
		}

		for (const { groupId } of listBridgeGroupMappings(ownerUsername))
			outboundRegistered.add(groupId)

		/**
		 * @param {object} dto DTO
		 */
		async function ingestDto(dto) {
			await charAPI.interfaces.wechat?.TweakInboundDto?.(dto)
			await postBridgeMessage(ownerUsername, dto)
			const { ensureBridgeGroup } = await import('../../chat/src/chat/bridge/registry.mjs')
			const { getState } = await import('../../chat/src/chat/dag/materialize.mjs')
			const { groupId } = await ensureBridgeGroup(ownerUsername, {
				platform: dto.platform,
				platformChatId: dto.platformChatId,
				chatKind: dto.chatKind,
				name: dto.chatName,
			})
			const { state } = await getState(ownerUsername, groupId)
			if (state.groupSettings?.bridge)
				await ensureOutboundHandler(groupId, state.groupSettings.bridge)
		}

		try {
			while (!context.signal.aborted) {
				let resp
				try {
					resp = await context.getUpdates({ get_updates_buf: getUpdatesCursor, timeoutMs: longPollTimeoutMs })
				}
				catch (error) {
					if (context.signal.aborted) break
					console.error('[WechatBridge] getUpdates 错误:', error)
					await new Promise(resolve => setTimeout(resolve, 2000))
					continue
				}

				if (context.signal.aborted) break
				if (resp?.errcode === -14)
					throw new Error('微信会话已失效（errcode -14），请重新完成渠道登录并更新 Token。')

				if (resp?.ret !== 0 && resp?.ret !== undefined) {
					console.error('[WechatBridge] getUpdates 非成功 ret:', resp.ret, resp.errmsg)
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

				for (const wechatMessage of resp?.msgs || []) {
					const dedupKey = wechatMessage.message_id != null
						? `m${wechatMessage.message_id}`
						: `s${wechatMessage.seq}:${wechatMessage.client_id || ''}`
					if (processedIds.has(dedupKey)) continue
					processedIds.add(dedupKey)

					if (wechatMessage.message_type !== WechatMessageType.USER) continue
					if (wechatMessage.message_state === WechatMessageState.GENERATING) continue
					if (!wechatMessageHasContent(wechatMessage)) continue

					if (wechatMessage.from_user_id)
						lastToUserId = String(wechatMessage.from_user_id)
					lastContextToken = String(wechatMessage.context_token || '')

					const dto = await wechatMessageToBridgeDto(
						wechatMessage,
						ownerUsername,
						cdnBaseUrl,
						context.signal,
						ownerDisplayName,
					)
					if (!dto) continue
					try {
						await ingestDto(dto)
					}
					catch (error) {
						console.error('[WechatBridge] postBridgeMessage failed:', error)
					}
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
		 *
		 * @param context
		 * @param config
		 */
		OnceClientReady: async (context, config) => {
			await SimpleWechatBotMain(context, config)
		},
		GetBotConfigTemplate: GetSimpleBotConfigTemplate,
	}
}
