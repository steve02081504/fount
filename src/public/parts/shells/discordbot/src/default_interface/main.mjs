import { Buffer } from 'node:buffer'
import { setInterval, clearInterval, setTimeout } from 'node:timers'

import { Events, ChannelType, GatewayIntentBits, Partials, escapeMarkdown } from 'npm:discord.js'

import { localhostLocales, console } from '../../../../../../scripts/i18n.mjs'
import { getAnyPreferredDefaultPart, loadPart } from '../../../../../../server/parts_loader.mjs'

import { getMessageFullContent, splitDiscordReply } from './tools.mjs'

/** @typedef {import('npm:discord.js').Message} Message */
/** @typedef {import('../../../chat/decl/chatLog.ts').chatLogEntry_t} FountChatLogEntryBase */
/**
 *  @typedef { (FountChatLogEntryBase & {
 *	extension?: {discord_message_id?: string, [key: string]: any }
 * })} chatLogEntry_t_simple
 */
/** @typedef {import('../../../chat/decl/chatLog.ts').chatReply_t} ChatReply_t */

/**
 * 尝试执行一个函数几次，如果失败则等待一段时间后重试。
 * @param {Function} func - 要执行的异步函数。
 * @param {object} [options] - 选项对象。
 * @param {number} [options.times=3] - 重试次数。
 * @param {number} [options.WhenFailsWaitFor=2000] - 失败后等待的毫秒数。
 * @returns {Promise<any>} 函数执行结果的 Promise。
 */
async function tryFewTimes(func, { times = 3, WhenFailsWaitFor = 2000 } = {}) {
	let lastError
	for (let i = 0; i < times; i++) try {
		return await func()
	} catch (error) {
		lastError = error
		if (i < times - 1) await new Promise(resolve => setTimeout(resolve, WhenFailsWaitFor))
	}

	throw lastError
}

/**
 * 创建一个简单的 Discord 接口。
 * @param {import('../../../../../../decl/charAPI.ts').CharAPI_t} charAPI - 角色 API 对象。
 * @param {string} ownerUsername - 所有者的用户名。
 * @param {string} botCharname - 机器人角色的名称。
 * @returns {Promise<object>} 返回一个包含 Discord 接口方法的 Promise。
 */
export async function createSimpleDiscordInterface(charAPI, ownerUsername, botCharname) {
	if (!charAPI?.interfaces?.chat?.GetReply)
		throw new Error('charAPI.interfaces.chat.GetReply is required for SimpleDiscordInterface.')

	/**
	 * @returns {{OwnerUserName: string, MaxMessageDepth: number, MaxFetchCount: number, ReplyToAllMessages: boolean}} 返回一个包含简单机器人配置模板的对象。
	 */
	function GetSimpleBotConfigTemplate() {
		return {
			OwnerUserName: 'your_discord_username', // Discord 用户名, 不是Fount用户名
			MaxMessageDepth: 20,
			MaxFetchCount: 30,
			ReplyToAllMessages: false, // 若开启则对所有消息做出回复
		}
	}

	/**
	 * Discord 机器人的主函数。
	 * @param {import('npm:discord.js').Client} client - Discord 客户端实例。
	 * @param {object} config - 机器人配置。
	 * @returns {Promise<void>}
	 */
	async function SimpleDiscordBotMain(client, config) {
		const MAX_MESSAGE_DEPTH = config.MaxMessageDepth || 20
		const MAX_FETCH_COUNT = config.MaxFetchCount || Math.max(MAX_MESSAGE_DEPTH, Math.floor(MAX_MESSAGE_DEPTH * 1.5))

		const ChannelChatLogs = {} // Record<string, chatLogEntry_t_simple[]>
		const userInfoCache = {}   // Record<string, string> 用户ID到显示名称
		const chat_scoped_char_memory = {} // AI的上下文记忆

		const ChannelMessageQueues = {} // Record<string, Message<boolean>[]>
		const ChannelHandlers = {}      // Record<string, Promise<void>>

		/** @type {Record<string, ChatReply_t>} 键为 bot 发出的 Discord 消息 ID，值为对应 AI 回复对象。 */
		const aiReplyObjectCache = {}

		/**
		 * 将 Discord 消息转换为 fount 聊天日志条目。
		 * @param {Message} discordMessage - Discord 消息对象。
		 * @returns {Promise<chatLogEntry_t_simple>} 转换后的 fount 聊天日志条目。
		 */
		async function DiscordMessageToFountChatLogEntry(discordMessage) {
			let fullMessage = discordMessage
			if (fullMessage.partial) try {
				fullMessage = await tryFewTimes(() => discordMessage.fetch())
			} catch (error) {
				console.error(`[SimpleDiscord] 获取部分消息 ${discordMessage.id} 失败:`, error)
				return null
			}

			const { author } = fullMessage
			if (!userInfoCache[author.id] || Math.random() < 0.1) try {
				const fetchedUser = await tryFewTimes(() => author.fetch())
				let displayName = fetchedUser.globalName || fetchedUser.username
				if (fullMessage.guild && fullMessage.member) {
					const member = fullMessage.member.partial ? await tryFewTimes(() => fullMessage.member.fetch()) : fullMessage.member
					displayName = member.displayName || displayName
				}
				userInfoCache[author.id] = displayName
			} catch (e) {
				if (!userInfoCache[author.id])
					userInfoCache[author.id] = author.globalName || author.username || `User_${author.id}`
			}

			const finalDisplayName = userInfoCache[author.id] || author.globalName || author.username

			const content = await getMessageFullContent(fullMessage, client)
			const files = []
			const attachmentSources = [
				fullMessage.attachments.values(),
				...fullMessage.messageSnapshots?.flatMap(s => s.attachments.values()) || []
			]
			for (const source of attachmentSources)
				for (const attachment of source)
					if (attachment.url) try {
						const buffer = Buffer.from(await tryFewTimes(() => fetch(attachment.url).then(r => r.arrayBuffer())))
						files.push({ name: attachment.name, buffer, description: attachment.description, mime_type: attachment.contentType })
					} catch (error) { console.error(`[SimpleDiscord] 获取附件 ${attachment.name} 失败:`, error) }

			for (const embed of fullMessage.embeds)
				if (embed.image?.url) try {
					const { url } = embed.image
					files.push({
						name: url.substring(url.lastIndexOf('/') + 1) || 'embedded_image.png',
						buffer: Buffer.from(await tryFewTimes(() => fetch(url).then(r => r.arrayBuffer()))),
						description: embed.title || embed.description || '',
						mime_type: 'image/png'
					})
				} catch (error) { console.error(`[SimpleDiscord] 获取embed图片 ${embed.image.url} 失败:`, error) }

			const cachedAIReply = aiReplyObjectCache[fullMessage.id]
			/** @type {chatLogEntry_t_simple} */
			const entry = {
				...cachedAIReply,
				time_stamp: fullMessage.createdTimestamp,
				role: author.id === client.user.id ? 'char' : author.username === config.OwnerUserName ? 'user' : 'char',
				name: author.id === client.user.id ? client.user.displayName || client.user.username : finalDisplayName,
				content,
				files: files.filter(Boolean),
				extension: { ...cachedAIReply?.extension, discord_message_id: fullMessage.id }
			}
			if (cachedAIReply) delete aiReplyObjectCache[fullMessage.id]

			return entry
		}

		/**
		 * 合并聊天日志。
		 * @param {chatLogEntry_t_simple[]} log - 聊天日志条目数组。
		 * @returns {chatLogEntry_t_simple[]} 合并后的聊天日志条目数组。
		 */
		function MargeChatLog(log) {
			if (!log?.length) return []
			const newlog = []
			let last = null
			for (const currentEntry of log) {
				const entry = { ...currentEntry } //浅拷贝，防止修改原数组
				if (entry.files) entry.files = [...entry.files] // 深拷贝文件数组
				if (entry.extension) entry.extension = { ...entry.extension } // 深拷贝extension

				if (last && last.name === entry.name && last.role === entry.role &&
					entry.time_stamp - last.time_stamp < 3 * 60000 && !last.files?.length) {
					last.content += '\n' + entry.content
					if (entry.files?.length) last.files = [...last.files || [], ...entry.files]
					last.time_stamp = entry.time_stamp
					if (entry.extension?.discord_message_id)
						last.extension = { ...last.extension, discord_message_id: entry.extension.discord_message_id }
				}
				else {
					if (last) newlog.push(last)
					last = entry
				}
			}
			if (last) newlog.push(last)
			return newlog
		}

		/**
		 * 处理消息队列。
		 * @param {string} channelId - 频道 ID。
		 * @returns {Promise<void>}
		 */
		async function HandleMessageQueue(channelId) {
			const myQueue = ChannelMessageQueues[channelId]
			try {
				if (!ChannelChatLogs[channelId]) {
					const firstMessageInQueue = myQueue[0]
					const fetchedMessages = await tryFewTimes(() => firstMessageInQueue.channel.messages.fetch({ limit: MAX_FETCH_COUNT, before: firstMessageInQueue.id }))
					const historicalMessages = Array.from(fetchedMessages.values()).reverse()
					const entries = (await Promise.all(historicalMessages.map(msg => DiscordMessageToFountChatLogEntry(msg)))).filter(Boolean)
					ChannelChatLogs[channelId] = MargeChatLog(entries)
				}

				while (myQueue.length) {
					const currentMessage = myQueue.shift()
					if (!currentMessage) continue

					const newUserEntry = await DiscordMessageToFountChatLogEntry(currentMessage)
					if (newUserEntry) {
						ChannelChatLogs[channelId].push(newUserEntry)
						ChannelChatLogs[channelId] = MargeChatLog(ChannelChatLogs[channelId])
						while (ChannelChatLogs[channelId].length > MAX_MESSAGE_DEPTH) {
							const removed = ChannelChatLogs[channelId].shift()
							delete aiReplyObjectCache[removed?.extension?.discord_message_id]
						}
					}
					else continue

					let triggerMessage = currentMessage
					if (triggerMessage.partial) triggerMessage = await tryFewTimes(() => triggerMessage.fetch())

					const shouldReply = config.ReplyToAllMessages ||
						(triggerMessage.channel.type === ChannelType.DM && triggerMessage.author.username === config.OwnerUserName) ||
						triggerMessage.mentions.users.has(client.user.id)

					if (shouldReply && triggerMessage.author.id !== client.user.id && !triggerMessage.author.bot)
						await DoMessageReply(triggerMessage, channelId)
				}
			}
			catch (error) {
				console.error(`[SimpleDiscord] 处理频道 ${channelId} 消息队列出错:`, error)
			}
			finally {
				delete ChannelHandlers[channelId]
			}
		}

		/**
		 * 处理消息回复。
		 * @param {Message} triggerMessage - 触发回复的 Discord 消息对象。
		 * @param {string} channelId - 频道 ID。
		 * @returns {Promise<void>}
		 */
		async function DoMessageReply(triggerMessage, channelId) {
			let typingInterval = setInterval(() => { triggerMessage.channel.sendTyping().catch(_ => 0) }, 7000).unref()

			/**
			 * 发送消息并缓存AI原始回复对象 (如果提供了)
			 * @param {import('npm:discord.js').MessagePayload | string} payload - 消息负载或字符串。
			 * @param {ChatReply_t} originalAIReply - 原始 AI 回复对象。
			 * @returns {Promise<Message>} 发送的 Discord 消息。
			 */
			async function sendAndCache(payload, originalAIReply) {
				try {
					const sentDiscordMessage = await tryFewTimes(() => triggerMessage.channel.send(payload))
					if (sentDiscordMessage && originalAIReply)
						aiReplyObjectCache[sentDiscordMessage.id] = originalAIReply

					return sentDiscordMessage
				}
				catch (error) {
					console.error('[SimpleDiscord] 发送消息失败: ', error, 'Payload content length:', payload?.content?.length)
					return null
				}
			}

			/**
			 * 发送分割回复。
			 * @param {ChatReply_t} fountReply - fount 聊天回复对象。
			 * @returns {Promise<void>}
			 */
			async function sendSplitReply(fountReply) {
				const MAX_FILES_PER_MESSAGE = 10
				const filesToSend = (fountReply.files || []).map(f => ({ attachment: f.buffer, name: f.name, description: f.description }))
				const textChunks = splitDiscordReply(fountReply.content_for_show || fountReply.content || '')

				const fileChunks = []
				for (let i = 0; i < filesToSend.length; i += MAX_FILES_PER_MESSAGE)
					fileChunks.push(filesToSend.slice(i, i + MAX_FILES_PER_MESSAGE))

				if (!textChunks.length && !fileChunks.length) return

				for (let i = 0; i < textChunks.length; i++) {
					const isLastTextMessage = i === textChunks.length - 1
					const payload = { content: textChunks[i] }
					if (isLastTextMessage && fileChunks.length)
						payload.files = fileChunks.shift()

					const isLastOverallMessage = isLastTextMessage && !fileChunks.length
					await sendAndCache(payload, isLastOverallMessage ? fountReply : undefined)
				}

				for (let i = 0; i < fileChunks.length; i++) {
					const payload = { files: fileChunks[i] }
					const isLastOverallMessage = i === fileChunks.length - 1
					await sendAndCache(payload, isLastOverallMessage ? fountReply : undefined)
				}
			}

			try {
				/**
				 * 添加聊天日志条目。
				 * @param {ChatReply_t} replyFromChar - 角色回复对象。
				 * @returns {Promise<null>} 一个不返回任何值的 Promise。
				 */
				const AddChatLogEntry = async replyFromChar => {
					if (replyFromChar && (replyFromChar.content || replyFromChar.files?.length))
						await sendSplitReply(replyFromChar)

					return null
				}

				/**
				 * 生成聊天回复请求。
				 * @returns {Promise<object>} 返回一个聊天回复请求对象。
				 */
				const generateChatReplyRequest = async () => ({
					supported_functions: { markdown: true, files: true, add_message: true },
					username: ownerUsername,
					chat_name: triggerMessage.channel.type === ChannelType.DM ? `DM with ${triggerMessage.author.tag}` : `${triggerMessage.guild?.name || 'N/A'}: #${triggerMessage.channel.name}`,
					char_id: botCharname,
					Charname: client.user.displayName || client.user.username,
					UserCharname: config.OwnerUserName,
					ReplyToCharname: userInfoCache[triggerMessage.author.id] || triggerMessage.author.username,
					locales: localhostLocales, time: new Date(), world: null, user: await (async () => { const n = getAnyPreferredDefaultPart(ownerUsername, 'personas'); if (n) return loadPart(ownerUsername, 'personas/' + n); return null })(), char: charAPI, other_chars: [], plugins: {},
					chat_scoped_char_memory, chat_log: ChannelChatLogs[channelId].map(e => ({ ...e })),
					AddChatLogEntry, /**
					 * @returns {Promise<object>} 返回一个更新后的聊天回复请求对象。
					 */
					Update: async () => await generateChatReplyRequest(),
					extension: { platform: 'discord', trigger_message_id: triggerMessage.id, channel_id: channelId, guild_id: triggerMessage.guild?.id }
				})

				const aiFinalReply = await charAPI.interfaces.chat.GetReply(await generateChatReplyRequest())

				if (aiFinalReply && (aiFinalReply.content || aiFinalReply.files?.length))
					await sendSplitReply(aiFinalReply)
			}
			catch (error) {
				console.error(`[SimpleDiscord] Error in DoMessageReply for message ${triggerMessage.id} in channel ${channelId}:`, error)
				console.error('[SimpleDiscord] 错误堆栈:', error.stack)
				try {
					const errorMessage = `Sorry, an error occurred while replying to your message: ${escapeMarkdown(error.message || 'Unknown error')}`
					await triggerMessage.channel.send(errorMessage)
				}
				catch (sendError) {
					console.error(`[SimpleDiscord] Failed to send error reply for message ${triggerMessage.id}:`, sendError)
				}
			}
			finally {
				if (typingInterval) clearInterval(typingInterval); typingInterval = null
			}
		}

		client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
			try {
				const fetchedNewMessage = await tryFewTimes(() => newMessage.fetch().catch(e => {
					if (e.code === 10008) return null
					throw e
				}))
				if (!fetchedNewMessage) {
					console.log(`[SimpleDiscord] Updated message ${newMessage.id} not found or deleted, skipping processing.`)
					return
				}

				const channelId = fetchedNewMessage.channel.id
				const channelLogs = ChannelChatLogs[channelId]
				if (!channelLogs) return

				const fountEntry = await DiscordMessageToFountChatLogEntry(fetchedNewMessage)
				if (!fountEntry) return

				const messageId = fetchedNewMessage.id
				const existingIndex = channelLogs.findIndex(entry =>
					entry.extension?.discord_message_id === messageId
				)

				if (existingIndex >= 0) {
					channelLogs[existingIndex] = fountEntry
					ChannelChatLogs[channelId] = MargeChatLog(channelLogs)
				}
				else {
					channelLogs.push(fountEntry)
					const merged = MargeChatLog(channelLogs)
					ChannelChatLogs[channelId] = merged
					while (merged.length > MAX_MESSAGE_DEPTH) {
						const removed = merged.shift()
						delete aiReplyObjectCache[removed?.extension?.discord_message_id]
					}
				}
			}
			catch (error) {
				console.error(`[SimpleDiscord] Error processing message update for ${newMessage.id}:`, error)
			}
		})

		client.on(Events.MessageDelete, async message => {
			try {
				if (!message.id || !message.channelId) {
					console.warn('[SimpleDiscord] Received MessageDelete event with missing id or channelId.')
					return
				}

				const { channelId } = message
				const channelLogs = ChannelChatLogs[channelId]
				if (!channelLogs) return

				const messageId = message.id
				const indexToRemove = channelLogs.findIndex(entry =>
					entry.extension?.discord_message_id === messageId
				)

				if (indexToRemove >= 0) {
					const removed = channelLogs.splice(indexToRemove, 1)[0]
					delete aiReplyObjectCache[removed?.extension?.discord_message_id]
					console.log(`[SimpleDiscord] Removed deleted message ${messageId} from chat log.`)
				}
			}
			catch (error) {
				console.error(`[SimpleDiscord] Error processing message delete for ${message.id}:`, error)
			}
		})

		client.on(Events.MessageCreate, async message => {
			let fullMessage = message
			if (fullMessage.partial)
				try { fullMessage = await tryFewTimes(() => message.fetch()) }
				catch (error) { console.error(`[SimpleDiscord] MessageCreate 获取部分消息 ${message.id} 失败:`, error); return }

			const channelId = fullMessage.channel.id;
			(ChannelMessageQueues[channelId] ??= []).push(fullMessage)
			if (!ChannelHandlers[channelId]) ChannelHandlers[channelId] = HandleMessageQueue(channelId)
		})
	}

	return {
		Intents: [
			GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages,
			GatewayIntentBits.GuildMembers,
		],
		Partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember],
		OnceClientReady: SimpleDiscordBotMain,
		GetBotConfigTemplate: GetSimpleBotConfigTemplate,
	}
}
