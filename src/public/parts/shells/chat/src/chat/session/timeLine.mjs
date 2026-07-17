/**
 * 【文件】timeLine.mjs — 聊天时间线分支切换与再生
 * 【职责】getChatTimelineCursor 返回当前分支索引；modifyTimeLine 按 delta 在 timeLines 间切换，必要时新建分支并触发生成或问候重 roll。
 * 【原理】切换前 abortAllGenerations；越界新建占位条目替换 chatLog 末条并 broadcast message_replaced；greeting_type 分支走 GetGreeting/GetGroupGreeting，否则 executeGeneration；已有分支仅恢复 LastTimeSlice 与末条日志。
 * 【数据结构】chatMetadata.timeLines、timeLineIndex、与 chatLog 末条同步的 entry。
 * 【关联】generationAbort、triggerReply、chatRequest、logEntries、broadcast。
 */
/** @typedef {import('../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../../decl/basedefs.ts').locale_t} locale_t */





import { broadcastGroupEvent } from './broadcast.mjs'
import { getChatRequest } from './chatRequest.mjs'
import { abortAllGenerations, createGenerationStream } from './generationAbort.mjs'
import {
	buildChatLogEntryFromCharReply,
	getChannelForCharStream,
} from './logEntries.mjs'
import { chatLogEntry_t } from './models.mjs'
import { getActiveGroupRuntime } from './persistence.mjs'
import { executeGeneration } from './triggerReply.mjs'


/**
 * 读取时间线游标位置。
 * @param {string} groupId 群 ID
 * @returns {Promise<{ current: number, total: number } | null>} 游标；无会话时为 null
 */
export async function getChatTimelineCursor(groupId) {
	const chatMetadata = await getActiveGroupRuntime(groupId)
	if (!chatMetadata) return null
	const total = Math.max(1, chatMetadata.timeLines?.length || 1)
	const raw = Number(chatMetadata.timeLineIndex) || 0
	const current = Math.min(Math.max(0, raw), total - 1)
	return { current, total }
}

/**
 * 按 delta 切换时间线分支并可能触发生成。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {number} delta 游标偏移（±1）
 * @returns {Promise<object>} 当前时间线条目
 */
export async function modifyTimeLine(groupId, channelId, delta) {
	abortAllGenerations(groupId)

	const chatMetadata = await getActiveGroupRuntime(groupId)

	let newTimeLineIndex = delta === Number.POSITIVE_INFINITY
		? chatMetadata.timeLines.length - 1
		: chatMetadata.timeLineIndex + delta

	if (newTimeLineIndex < 0)
		newTimeLineIndex = chatMetadata.timeLines.length - 1

	let entry

	if (newTimeLineIndex >= chatMetadata.timeLines.length) {
		const previousEntry = chatMetadata.chatLog[chatMetadata.chatLog.length - 1]
		const timeSlice = previousEntry.extension.timeSlice
		const { greeting_type } = timeSlice

		const newEntry = new chatLogEntry_t()
		newEntry.id = crypto.randomUUID()
		newEntry.extension.timeSlice = timeSlice.copy()
		newEntry.extension.timeSlice.greeting_type = greeting_type
		newEntry.extension.timeSlice.charname = timeSlice.charname

		newEntry.role = previousEntry.role
		newEntry.name = previousEntry.name
		newEntry.avatar = previousEntry.avatar

		newEntry.is_generating = true
		newEntry.content = ''
		newEntry.files = []
		newEntry.time_stamp = new Date()

		chatMetadata.timeLines.push(newEntry)
		newTimeLineIndex = chatMetadata.timeLines.length - 1
		chatMetadata.timeLineIndex = newTimeLineIndex

		chatMetadata.chatLog[chatMetadata.chatLog.length - 1] = newEntry
		entry = newEntry

		broadcastGroupEvent(groupId, {
			type: 'message_replaced',
			payload: { index: chatMetadata.chatLog.length - 1, entry: await newEntry.toData(chatMetadata.username) },
		})

		if (greeting_type)
			try {
				const { charname } = timeSlice
				const request = await getChatRequest(groupId, charname || undefined, getChannelForCharStream(chatMetadata, newEntry))
				let result

				const { world, chars } = timeSlice
				const char = charname ? chars[charname] : null

				switch (greeting_type) {
					case 'single':
						result = await char.interfaces.chat.GetGreeting(request, newTimeLineIndex)
						break
					case 'group':
						result = await char.interfaces.chat.GetGroupGreeting(request, newTimeLineIndex)
						break
					case 'world_single':
						result = await world.interfaces.chat.GetGreeting(request, newTimeLineIndex)
						break
					case 'world_group':
						result = await world.interfaces.chat.GetGroupGreeting(request, newTimeLineIndex)
						break
					default:
						if (char) result = await char.interfaces.chat.GetReply(request)
						break
				}

				if (!result) throw new Error('No greeting result')

				const newTimeSlice = timeSlice.copy()
				newTimeSlice.greeting_type = greeting_type

				let finalEntry
				if (greeting_type.startsWith('world_'))
					finalEntry = await buildChatLogEntryFromCharReply(result, newTimeSlice, null, undefined, chatMetadata.username)
				else
					finalEntry = await buildChatLogEntryFromCharReply(result, newTimeSlice, char, charname, chatMetadata.username)

				Object.assign(newEntry, finalEntry)
				newEntry.is_generating = false
				newEntry.id = entry.id

				chatMetadata.timeLines[newTimeLineIndex] = newEntry
				chatMetadata.chatLog[chatMetadata.chatLog.length - 1] = newEntry
				chatMetadata.LastTimeSlice = newEntry.extension.timeSlice

				broadcastGroupEvent(groupId, {
					type: 'message_replaced',
					payload: { index: chatMetadata.chatLog.length - 1, entry: await newEntry.toData(chatMetadata.username) },
				})
			} catch (e) {
				console.error('Greeting generation failed:', e)
				newEntry.content = `\`\`\`\nError generating greeting:\n${e.message}\n\`\`\``
				newEntry.is_generating = false
				newEntry.id = entry.id
				newEntry.extension.timeSlice = timeSlice
				broadcastGroupEvent(groupId, {
					type: 'message_replaced',
					payload: { index: chatMetadata.chatLog.length - 1, entry: await newEntry.toData(chatMetadata.username) },
				})
			}
		else {
			const { charname } = timeSlice
			const request = await getChatRequest(groupId, charname, getChannelForCharStream(chatMetadata, newEntry))
			const stream = createGenerationStream(groupId, newEntry.id)
			void executeGeneration(groupId, request, stream, newEntry, chatMetadata)
				.catch(err => console.error('executeGeneration error:', err))
		}
	} else {
		entry = chatMetadata.timeLines[newTimeLineIndex]
		chatMetadata.timeLineIndex = newTimeLineIndex
		chatMetadata.LastTimeSlice = entry.extension.timeSlice
		chatMetadata.chatLog[chatMetadata.chatLog.length - 1] = entry

		broadcastGroupEvent(groupId, {
			type: 'message_replaced',
			payload: { index: chatMetadata.chatLog.length - 1, entry: await entry.toData(chatMetadata.username) }
		})
	}

	return entry
}
