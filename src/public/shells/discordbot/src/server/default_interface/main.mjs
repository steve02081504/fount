import { Events, ChannelType, GatewayIntentBits, Partials, escapeMarkdown } from 'npm:discord.js'
import { Buffer } from 'node:buffer'
import { getMessageFullContent, splitDiscordReply } from './tools.mjs'
import { localhostLocales } from '../../../../../../scripts/i18n.mjs'

/** @typedef {import('npm:discord.js').Message} Message */
/** @typedef {import('../../../../chat/decl/chatLog.ts').chatLogEntry_t} FountChatLogEntryBase */
/**
 *  @typedef { (FountChatLogEntryBase & {
 *	extension?: {discord_message_id?: string, [key: string]: any }
 * })} chatLogEntry_t_simple
 */
/** @typedef {import('../../../../chat/decl/chatLog.ts').chatReply_t} ChatReply_t */

async function tryFewTimes(func, { times = 3, WhenFailsWaitFor = 2000 } = {}) {
	let lastError
	for (let i = 0; i < times; i++)
		try {
			return await func()
		} catch (error) {
			lastError = error
			if (i < times - 1) await new Promise(resolve => setTimeout(resolve, WhenFailsWaitFor))
		}

	throw lastError
}

export async function createSimpleDiscordInterface(charAPI, ownerUsername, botCharname) {
	if (!charAPI?.interfaces?.chat?.GetReply)
		throw new Error('charAPI.interfaces.chat.GetReply is required for SimpleDiscordInterface.')

	function GetSimpleBotConfigTemplate() {
		return {
			OwnerUserName: 'your_discord_username', // Discord 用户名, 不是Fount用户名
			MaxMessageDepth: 20,
			MaxFetchCount: 30,
		}
	}

	async function SimpleDiscordBotMain(client, config) {
		const MAX_MESSAGE_DEPTH = config.MaxMessageDepth || 20
		const MAX_FETCH_COUNT = config.MaxFetchCount || Math.max(MAX_MESSAGE_DEPTH, Math.floor(MAX_MESSAGE_DEPTH * 1.5))

		const ChannelChatLogs = {} // Record<string, chatLogEntry_t_simple[]>
		const userInfoCache = {}   // Record<string, string> 用户ID到显示名称
		const chat_scoped_char_memory = {} // AI的上下文记忆

		const ChannelMessageQueues = {} // Record<string, Message<boolean>[]>
		const ChannelHandlers = {}      // Record<string, Promise<void>>

		/**
		 * @type {Record<string, ChatReply_t>}
		 * 缓存机器人发送AI回复时，AI原始的回复对象。键是机器人发出的Discord消息ID。
		 * 完全对标龙胆的 replayInfoCache 逻辑。
		 */
		const aiReplyObjectCache = {}

		async function DiscordMessageToFountChatLogEntry(discordMessage) {
			let fullMessage = discordMessage
			if (fullMessage.partial)
				try {
					fullMessage = await tryFewTimes(() => discordMessage.fetch())
				} catch (error) {
					console.error(`[SimpleDiscord] 获取部分消息 ${discordMessage.id} 失败:`, error)
					return null // 获取失败则无法处理
				}


			const { author } = fullMessage
			if (!userInfoCache[author.id] || Math.random() < 0.1)
				try {
					const fetchedUser = await tryFewTimes(() => author.fetch())
					let displayName = fetchedUser.globalName || fetchedUser.username
					if (fullMessage.guild && fullMessage.member) {
						const member = fullMessage.member.partial ? await tryFewTimes(() => fullMessage.member.fetch()) : fullMessage.member
						displayName = member.displayName || displayName
					}
					userInfoCache[author.id] = displayName
				} catch (e) {
					if (!userInfoCache[author.id]) userInfoCache[author.id] = author.globalName || author.username || `User_${author.id}`
				}

			const finalDisplayName = userInfoCache[author.id] || author.globalName || author.username

			const content = await getMessageFullContent(fullMessage, client)
			const files = []
			const attachmentSources = [
				fullMessage.attachments.values(),
				...fullMessage.messageSnapshots?.flatMap(s => s.attachments.values()) || []
			]
			for (const source of attachmentSources)
				for (const attachment of source) {
					if (!attachment.url) continue
					try {
						const buffer = Buffer.from(await tryFewTimes(() => fetch(attachment.url).then(r => r.arrayBuffer())))
						files.push({ name: attachment.name, buffer, description: attachment.description, mime_type: attachment.contentType })
					} catch (error) { console.error(`[SimpleDiscord] 获取附件 ${attachment.name} 失败:`, error) }
				}

			for (const embed of fullMessage.embeds)
				if (embed.image?.url)
					try {
						const { url } = embed.image
						files.push({
							name: url.substring(url.lastIndexOf('/') + 1) || 'embedded_image.png',
							buffer: Buffer.from(await tryFewTimes(() => fetch(url).then(r => r.arrayBuffer()))),
							description: embed.title || embed.description || '',
							mime_type: 'image/png' // 简化处理，实际应更精确
						})
					} catch (error) { console.error(`[SimpleDiscord] 获取embed图片 ${embed.image.url} 失败:`, error) }



			// 核心：从aiReplyObjectCache恢复extension，完全模仿龙胆
			const cachedAIReply = aiReplyObjectCache[fullMessage.id]
			/** @type {chatLogEntry_t_simple} */
			const entry = {
				...cachedAIReply || { extension: {} }, // 如果缓存命中，其extension会覆盖这里的空对象
				time_stamp: fullMessage.createdTimestamp,
				role: author.id === client.user.id ? 'char' : author.username === config.OwnerUserName ? 'user' : 'char',
				name: author.id === client.user.id ? client.user.displayName || client.user.username : finalDisplayName,
				content,
				files: files.filter(Boolean),
				// 确保discord_message_id总是最新的
				extension: { ...cachedAIReply?.extension, discord_message_id: fullMessage.id }
			}
			if (cachedAIReply) delete aiReplyObjectCache[fullMessage.id] // 用后即焚，同龙胆

			return entry
		}

		function MargeChatLog(log) {
			if (!log || log.length === 0) return []
			const newlog = []
			let last = null
			for (const currentEntry of log) {
				const entry = { ...currentEntry } //浅拷贝，防止修改原数组
				if (entry.files) entry.files = [...entry.files] // 深拷贝文件数组
				if (entry.extension) entry.extension = { ...entry.extension } // 深拷贝extension

				if (last && last.name === entry.name && last.role === entry.role &&
					entry.time_stamp - last.time_stamp < 3 * 60000 && (last.files?.length || 0) === 0) {
					last.content += '\n' + entry.content
					if (entry.files?.length > 0) last.files = [...last.files || [], ...entry.files]
					last.time_stamp = entry.time_stamp
					if (entry.extension?.discord_message_id)
						last.extension = { ...last.extension, discord_message_id: entry.extension.discord_message_id }
				} else {
					if (last) newlog.push(last)
					last = entry
				}
			}
			if (last) newlog.push(last)
			return newlog
		}

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

				while (myQueue.length > 0) {
					const currentMessage = myQueue.shift()
					if (!currentMessage) continue

					const newUserEntry = await DiscordMessageToFountChatLogEntry(currentMessage)
					if (newUserEntry) {
						ChannelChatLogs[channelId].push(newUserEntry)
						ChannelChatLogs[channelId] = MargeChatLog(ChannelChatLogs[channelId])
						while (ChannelChatLogs[channelId].length > MAX_MESSAGE_DEPTH) {
							const removed = ChannelChatLogs[channelId].shift()
							// 如果移除的条目在缓存中，也一并清除 (虽然理论上DiscordMessageToFountChatLogEntry已经清了)
							if (removed?.extension?.discord_message_id && aiReplyObjectCache[removed.extension.discord_message_id])
								delete aiReplyObjectCache[removed.extension.discord_message_id]
						}
					} else continue

					let triggerMessage = currentMessage
					if (triggerMessage.partial) triggerMessage = await tryFewTimes(() => triggerMessage.fetch())

					const shouldReply = (triggerMessage.channel.type === ChannelType.DM && triggerMessage.author.username === config.OwnerUserName) ||
						triggerMessage.mentions.users.has(client.user.id)

					if (shouldReply && triggerMessage.author.id !== client.user.id && !triggerMessage.author.bot)
						await DoMessageReply(triggerMessage, channelId)
				}
			} catch (error) {
				console.error(`[SimpleDiscord] 处理频道 ${channelId} 消息队列出错:`, error)
			} finally {
				delete ChannelHandlers[channelId]
			}
		}

		async function DoMessageReply(triggerMessage, channelId) {
			let typingInterval = setInterval(() => { triggerMessage.channel.sendTyping().catch(e => { }) }, 7000)

			/** 发送消息并缓存AI原始回复对象 (如果提供了) */
			async function sendAndCache(payload, originalAIReply) {
				try {
					const sentDiscordMessage = await tryFewTimes(() => triggerMessage.channel.send(payload))
					if (sentDiscordMessage && originalAIReply)
						aiReplyObjectCache[sentDiscordMessage.id] = originalAIReply

					return sentDiscordMessage
				} catch (error) {
					console.error('[SimpleDiscord] 发送消息失败: ', error, 'Payload content length:', payload?.content?.length)
					// 不在此处向频道发送错误，由顶层处理
					return null
				}
			}

			async function sendSplitReply(fountReply) {
				const MAX_FILES_PER_MESSAGE = 10
				const filesToSend = (fountReply.files || []).map(f => ({ attachment: f.buffer, name: f.name, description: f.description }))
				const textChunks = splitDiscordReply(fountReply.content || '')

				const fileChunks = []
				for (let i = 0; i < filesToSend.length; i += MAX_FILES_PER_MESSAGE)
					fileChunks.push(filesToSend.slice(i, i + MAX_FILES_PER_MESSAGE))


				if (textChunks.length === 0 && fileChunks.length === 0) return // 无任何内容，不发送

				// 1. 发送所有文本消息。最后一个文本块会带上第一个文件块（如果存在）。
				for (let i = 0; i < textChunks.length; i++) {
					const isLastTextMessage = i === textChunks.length - 1
					const payload = { content: textChunks[i] }

					// 核心：如果是最后一个文本块，并且有文件要发送，则附加第一个文件块
					if (isLastTextMessage && fileChunks.length > 0)
						payload.files = fileChunks.shift() // 附加并从待处理队列中移除


					const isLastOverallMessage = isLastTextMessage && fileChunks.length === 0
					await sendAndCache(payload, isLastOverallMessage ? fountReply : undefined)
				}

				// 2. 发送所有剩余的文件块。
				// 这个循环会在以下情况执行：
				// a) 根本没有文本，只有文件。
				// b) 文本发送完毕后，还有剩余的文件块。
				for (let i = 0; i < fileChunks.length; i++) {
					const payload = { files: fileChunks[i] }
					const isLastOverallMessage = i === fileChunks.length - 1
					await sendAndCache(payload, isLastOverallMessage ? fountReply : undefined)
				}
			}

			try {
				const AddChatLogEntry = async (replyFromChar) => { // AI调用的中间消息发送函数
					if (replyFromChar && (replyFromChar.content || replyFromChar.files?.length))
						await sendSplitReply(replyFromChar)

					return null
				}

				const generateChatReplyRequest = () => ({
					supported_functions: { markdown: true, files: true, add_message: true },
					username: config.OwnerUserName,
					chat_name: triggerMessage.channel.type === ChannelType.DM ? `DM with ${triggerMessage.author.tag}` : `${triggerMessage.guild?.name || 'N/A'}: #${triggerMessage.channel.name}`,
					char_id: botCharname,
					Charname: client.user.displayName || client.user.username,
					UserCharname: config.OwnerUserName,
					ReplyToCharname: userInfoCache[triggerMessage.author.id] || triggerMessage.author.username,
					locales: localhostLocales, time: new Date(), world: null, user: null, char: charAPI, other_chars: [], plugins: {},
					chat_scoped_char_memory, chat_log: ChannelChatLogs[channelId].map(e => ({ ...e })), // 传递副本
					AddChatLogEntry, Update: async () => generateChatReplyRequest(),
					extension: { platform: 'discord', trigger_message_id: triggerMessage.id, channel_id: channelId, guild_id: triggerMessage.guild?.id }
				})

				const aiFinalReply = await charAPI.interfaces.chat.GetReply(generateChatReplyRequest())

				if (aiFinalReply && (aiFinalReply.content || aiFinalReply.files?.length))
					await sendSplitReply(aiFinalReply)
			} catch (error) {
				console.error(`[SimpleDiscord] Error in DoMessageReply for message ${triggerMessage.id} in channel ${channelId}:`, error)
				try {
					await triggerMessage.channel.send(`Sorry, an error occurred while replying to your message: ${escapeMarkdown(error.message)}`)
				} catch (sendError) {
					console.error(`[SimpleDiscord] Failed to send error reply for message ${triggerMessage.id}:`, sendError)
				}
			} finally {
				if (typingInterval) clearInterval(typingInterval); typingInterval = null
			}
		}

		client.on(Events.MessageCreate, async (message) => {
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
