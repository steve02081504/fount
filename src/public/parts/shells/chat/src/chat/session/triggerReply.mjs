/**
 * 【文件】triggerReply.mjs — 角色回复触发、生成执行与多轮自动对话
 * 【职责】triggerCharReply 启动占位条目与 DAG generating 占位；executeGeneration 调用 char.GetReply 并 finalize；getCharReplyFrequency/handleAutoReply 实现发言顺序与加权轮询；跨机角色走 invokeGroupRpc。
 * 【原理】charReplyInFlight 防同 group+channel+char 并发；流式经 charPreviewStream 发签名 stream_chunk（slices）；结束后走 handleAutoReply（AfterAddChatLogEntry 已收归 DAG persist）；本机 bind 外发 RPC 带 buildSerializableRequest。
 * 【数据结构】charReplyInFlight（Set）、占位 chatLogEntry_t（is_generating、extension.dagEventId/groupChannelId）、replyFrequency 表。
 * 【关联】generationAbort、charPreviewStream、chatRequest、logEntries、dag/chatLogMirror、rpcInvoke。
 */
/** @typedef {import('../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../../decl/basedefs.ts').locale_t} locale_t */

import { inspect } from 'node:util'

import { isEntityHash128, parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { getPartDetails } from '../../../../../../../server/parts_loader.mjs'
import {
	appendDagGeneratingPlaceholder,
	cancelGeneratingPlaceholder,
	finalizeDagGeneratingMessage,
	syncChatLogEntryToDag,
} from '../dag/chatLogMirror.mjs'
import { getState } from '../dag/materialize.mjs'
import { getDefaultChannelId } from '../dag/queries.mjs'
import { resolveGroupChannelId } from '../lib/channelId.mjs'
import { persistLogContextSidecar, sidecarChannelForEntry } from '../lib/contextSidecar.mjs'
import { ensureLocalAgentEntityHash, memberEntityHash } from '../lib/entity.mjs'
import { finishStreamBuffer } from '../ws/groupWsStreamBuffer.mjs'

import { broadcastGroupEvent } from './broadcast.mjs'
import { dispatchCharError } from './charError.mjs'
import { createCharPreviewStream } from './charPreviewStream.mjs'
import { getChatRequest } from './chatRequest.mjs'
import { getMaterializedSession } from './dagSession.mjs'
import { createGenerationStream } from './generationAbort.mjs'
import {
	buildChatLogEntryFromCharReply,
	getChannelForCharStream,
} from './logEntries.mjs'
import { deleteMessage } from './messages.mjs'
import { chatLogEntry_t } from './models.mjs'
import { addchar } from './partConfig.mjs'
import { getActiveGroupRuntime } from './persistence.mjs'
import {
	autoReplyBucketKey,
	buildOnMessageEvent,
	consumeAutoReplyToken,
	loadAutoReplySettings,
} from './replyThrottle.mjs'
import { resolveChar, resolveWorld } from './resolvePart.mjs'
import { invokeGroupRpc } from './rpcInvoke.mjs'
import { getCharBind, getGroupRuntime, isLocalNode } from './runtime.mjs'
import { buildSerializableRequest } from './serializableRequest.mjs'
import { groupMetadatas } from './wsLifecycle.mjs'

/** @type {Set<string>} 进行中的角色生成（groupId\\0channelId\\0charname） */
const charReplyInFlight = new Set()

/**
 * @param {string} groupId 群 ID
 * @param {string | null | undefined} channelId 频道 ID
 * @param {string} charname 角色名
 * @returns {string} 去重键
 */
function charReplyFlightKey(groupId, channelId, charname) {
	return `${groupId}\0${channelId || 'default'}\0${charname}`
}

/**
 * @param {string} groupId 群 ID
 * @param {string | null | undefined} channelId 频道 ID
 * @param {string} charname 角色名
 * @returns {boolean} 是否已有同槽位生成在进行
 */
export function isCharReplyInFlight(groupId, channelId, charname) {
	return charReplyInFlight.has(charReplyFlightKey(groupId, channelId, charname))
}

/**
 * 角色回复结束后按发言顺序或频率触发下一位角色/用户轮次。
 * @param {string} groupId 群 ID
 * @param {string | null} channelId 频道 ID
 * @param {Array<{ charname: string | null, frequency: number }>} replyFrequency 频率表
 * @param {string | null} lastSpeakerCharname 上一发言角色名
 * @param {string | null | undefined} preferCharName 优先尝试回复的角色名
 * @returns {Promise<void>}
 */
export async function handleAutoReply(groupId, channelId, replyFrequency, lastSpeakerCharname, preferCharName) {
	const chatMetadata = await getActiveGroupRuntime(groupId)
	if (!chatMetadata) return
	const { username } = chatMetadata
	const effectiveChannelId = channelId || await getDefaultChannelId(username, groupId)
	const channelWorld = await resolveWorld(groupId, effectiveChannelId, username)
	const session = await getMaterializedSession(username, groupId)

	if (channelWorld.interfaces.chat.GetSpeakingOrder)
		try {
			const speakingOrderRequest = {
				groupId,
				channelId: effectiveChannelId,
				username,
				chatReplyRequest: await getChatRequest(groupId, undefined, effectiveChannelId, { replicaUsername: username }),
			}
			const order = channelWorld.interfaces.chat.GetSpeakingOrder(speakingOrderRequest)
			const turns = order?.[Symbol.asyncIterator]
				? await collectAsyncIterable(order)
				: order || []
			for (const turn of turns) {
				if (turn.type === 'char' && turn.memberId) {
					let charname = null
					if (isEntityHash128(turn.memberId)) {
						const parsed = parseEntityHash(turn.memberId)
						if (!parsed) continue
						const { state: speakState } = await getState(username, groupId)
						for (const [key, member] of Object.entries(speakState.members || {})) {
							if (member?.memberKind !== 'agent' || member.status !== 'active') continue
							if (memberEntityHash(member) === turn.memberId) {
								charname = member.charname || null
								break
							}
							void key
						}
						if (!charname) continue
					}
					else
						charname = turn.memberId

					if (session.chars?.[charname]) {
						await triggerCharReply(groupId, effectiveChannelId, charname, turn.requestOverride || null)
						return
					}
				}
				if (turn.type === 'user') {
					broadcastGroupEvent(groupId, { type: 'speaking_order_user_turn', payload: { channelId: effectiveChannelId } })
					return
				}
			}
		}
		catch (error) {
			console.error(error)
		}


	if (preferCharName && replyFrequency.some(entry => entry.charname === preferCharName))
		try {
			await triggerCharReply(groupId, effectiveChannelId, preferCharName)
			return
		}
		catch (error) {
			console.error(error)
		}

	let excludedCharname = lastSpeakerCharname
	while (true) {
		const nextCharname = pickNextCharForReply(replyFrequency.filter(entry => entry.charname !== excludedCharname))
		if (!nextCharname) return
		try {
			await triggerCharReply(groupId, effectiveChannelId, nextCharname)
			return
		}
		catch (error) {
			console.error(error)
			excludedCharname = nextCharname
		}
	}
}

/**
 * 执行单次角色生成流并同步 DAG / WebSocket。
 * @param {string} groupId 群 ID
 * @param {Awaited<ReturnType<typeof getChatRequest>>} request 角色聊天请求
 * @param {ReturnType<typeof createGenerationStream>} stream 流式推送句柄
 * @param {chatLogEntry_t} placeholderEntry 占位日志条目
 * @param {import('./models.mjs').chatMetadata_t} chatMetadata 会话元数据
 * @returns {Promise<void>}
 */
export async function executeGeneration(groupId, request, stream, placeholderEntry, chatMetadata) {
	const entryId = placeholderEntry.id
	const pendingStreamId = placeholderEntry.extension?.dagEventId || entryId
	const channelForStream = getChannelForCharStream(chatMetadata, placeholderEntry)

	/**
		 * 结束流：DAG `message_edit` 终稿（§6.4；无 `stream_end`）。
		 * @param {chatLogEntry_t} finalEntry 最终条目
		 * @param {boolean} [isError] 是否为错误占位内容
		 * @returns {Promise<chatLogEntry_t>} 最终条目
		 */
	const finalizeEntry = async (finalEntry, isError = false) => {
		finishStreamBuffer(groupId, pendingStreamId)
		stream.done()
		finalEntry.id = entryId
		finalEntry.is_generating = false

		let logIndex = chatMetadata.chatLog.findIndex(entry => entry.id === entryId)
		if (logIndex === -1) {
			chatMetadata.chatLog.push(finalEntry)
			logIndex = chatMetadata.chatLog.length - 1
			chatMetadata.timeLines = [finalEntry]
			chatMetadata.timeLineIndex = 0
		}
		else {
			chatMetadata.chatLog[logIndex] = finalEntry
			const timelineIndex = chatMetadata.timeLines.findIndex(entry => entry.id === entryId)
			if (timelineIndex !== -1)
				chatMetadata.timeLines[timelineIndex] = finalEntry
		}

		chatMetadata.LastTimeSlice = finalEntry.extension.timeSlice

		const owner = groupMetadatas.get(groupId)?.username
		if (owner && placeholderEntry.extension?.dagEventId)
			await finalizeDagGeneratingMessage(groupId, finalEntry, owner, placeholderEntry.extension.dagEventId)
		else if (owner && !isError && !finalEntry.extension?.aborted)
			await syncChatLogEntryToDag(groupId, finalEntry, owner)

		return finalEntry
	}

	try {
		const previewStream = createCharPreviewStream({
			username: chatMetadata.username,
			groupId,
			pendingStreamId,
			channelId: channelForStream,
			charId: request.char_id,
		})
		request.generation_options = {
			replyPreviewUpdater: previewStream.update,
			signal: stream.signal,
			supported_functions: request.supported_functions,
		}

		let typingTimer = null
		try {
			const { getChatClient } = await import('../../api/index.mjs')
			const selfHash = (await ensureLocalAgentEntityHash(chatMetadata.username, request.char_id)).toLowerCase()
			const genClient = await getChatClient(chatMetadata.username, selfHash)
			const genGroup = await genClient.group(groupId)
			const genChannel = await genGroup.channel(channelForStream)
			void genChannel.typing().catch(() => {})
			typingTimer = setInterval(() => {
				void genChannel.typing().catch(() => {})
			}, 5000)
			typingTimer.unref?.()
		}
		catch { /* agent ChatClient 不可用时跳过出站 typing 心跳 */ }

		let charReply
		try {
			// world 可代角色回复（GetCharReply 返回 null 表示放行给 char 本体）
			charReply = await request.world.interfaces.chat.GetCharReply?.(request, request.char_id)
				?? await request.char.interfaces.chat.GetReply(request)
		}
		finally {
			if (typingTimer) clearInterval(typingTimer)
		}

		if (charReply === null) {
			stream.abort('Generation result was null.')
			finishStreamBuffer(groupId, pendingStreamId)
			placeholderEntry.is_generating = false
			placeholderEntry.content = ''
			const owner = groupMetadatas.get(groupId)?.username
			if (owner)
				await cancelGeneratingPlaceholder(groupId, placeholderEntry, owner, pendingStreamId)
			const logIndex = chatMetadata.chatLog.findIndex(entry => entry.id === entryId)
			if (logIndex !== -1) await deleteMessage(groupId, logIndex)
			return
		}

		const finalEntry = await buildChatLogEntryFromCharReply(
			charReply,
			placeholderEntry.extension.timeSlice,
			request.char,
			request.char_id,
			chatMetadata.username,
		)
		finalEntry.extension = {
			...placeholderEntry.extension,
			...finalEntry.extension,
		}

		await persistLogContextSidecar(
			chatMetadata.username,
			groupId,
			sidecarChannelForEntry(finalEntry, channelForStream),
			finalEntry,
		)

		const savedEntry = await finalizeEntry(finalEntry, false)
		const replyFrequency = await getCharReplyFrequency(groupId)
		const savedChannelId = savedEntry.extension?.groupChannelId || null
		await handleAutoReply(groupId, savedChannelId, replyFrequency, savedEntry.extension.timeSlice.charname ?? null)
	}
	catch (error) {
		if (error.name === 'AbortError') {
			placeholderEntry.is_generating = false
			placeholderEntry.extension = { ...placeholderEntry.extension, aborted: true }
			await finalizeEntry(placeholderEntry, false)
		}
		else {
			const handled = await dispatchCharError(request.char, error, {
				username: chatMetadata.username,
				source: 'GetReply',
				groupId,
				channelId: channelForStream,
				charname: request.char_id,
			})
			if (handled) {
				placeholderEntry.is_generating = false
				const logIndex = chatMetadata.chatLog.findIndex(entry => entry.id === entryId)
				if (logIndex !== -1) await deleteMessage(groupId, logIndex)
				return
			}
			stream.abort(error?.message)
			placeholderEntry.content = `\`\`\`\nError:\n${formatGenerationError(error)}\n\`\`\``
			await finalizeEntry(placeholderEntry, true)
		}
	}
	finally {
		charReplyInFlight.delete(charReplyFlightKey(
			groupId,
			placeholderEntry.extension?.groupChannelId || channelForStream,
			request.char_id,
		))
	}
}

/**
 * 构建各角色回复权重（含 `OnMessage` 发言意愿）。
 * @param {string} groupId 群 ID
 * @returns {Promise<Array<{ charname: string | null, frequency: number }>>} 各角色权重列表
 */
export async function getCharReplyFrequency(groupId) {
	const chatMetadata = await getActiveGroupRuntime(groupId)
	if (!chatMetadata) throw new Error('Group not found')
	const result = [{ charname: null, frequency: 1 }]
	const defaultChannelId = await getDefaultChannelId(chatMetadata.username, groupId)
	const settings = await loadAutoReplySettings(chatMetadata.username, groupId)
	const session = await getMaterializedSession(chatMetadata.username, groupId)

	for (const charname of Object.keys(session.chars || {})) {
		const char = chatMetadata.LastTimeSlice.chars[charname]
			|| await resolveChar(groupId, charname, chatMetadata.username)
		if (!char) continue
		let frequency = session.charFrequencies?.[charname] ?? 1
		if (char.interfaces?.chat?.OnMessage) {
			const bucketKey = autoReplyBucketKey(groupId, defaultChannelId, charname)
			const event = await buildOnMessageEvent(chatMetadata.username, groupId, defaultChannelId, charname)
			let spoke = false
			try {
				spoke = await char.interfaces.chat.OnMessage(event)
			}
			catch (error) {
				await dispatchCharError(char, error, {
					username: chatMetadata.username,
					source: 'OnMessage',
					groupId,
					channelId: defaultChannelId,
					charname,
					event,
				})
				frequency = 0
				continue
			}
			frequency = spoke ? 1e6 : 0
			if (settings.enabled && spoke && frequency > 0) {
				const { allowed } = consumeAutoReplyToken(bucketKey, settings)
				if (!allowed) frequency = 0
			}
		}
		if (frequency > 0)
			result.push({ charname, frequency })
	}

	return result
}

/**
 * 按加权随机选择下一个应回复的角色名。
 * @param {Array<{ charname: string | null, frequency: number }>} replyFrequency 频率表
 * @returns {string | null | undefined} 角色名；无可选时 null/undefined
 */
export function pickNextCharForReply(replyFrequency) {
	const totalWeight = replyFrequency.reduce((sum, entry) => sum + entry.frequency, 0)
	if (totalWeight <= 0) return null
	let random = Math.random() * totalWeight
	for (const { charname, frequency } of replyFrequency) {
		if (random < frequency) return charname
		random -= frequency
	}
	return null
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string | null | undefined} charname 角色名
 * @returns {Promise<import('./models.mjs').chatMetadata_t>} 会话元数据
 */
async function ensureCharSession(groupId, channelId, charname) {
	const owner = groupMetadatas.get(groupId)?.username
	if (!owner) throw new Error('Group not found')
	const chatMetadata = await getGroupRuntime(groupId, owner)
	if (charname && !chatMetadata.LastTimeSlice.chars[charname])
		await addchar(groupId, charname, owner)
	return chatMetadata
}

/**
 * @param {string} groupId 群 ID
 * @param {chatLogEntry_t} placeholder 占位条目
 * @param {string | null | undefined} owner replica 所有者
 * @returns {Promise<void>}
 */
async function rollbackCharReplySetup(groupId, placeholder, owner) {
	if (owner && placeholder.extension?.dagEventId)
		await cancelGeneratingPlaceholder(groupId, placeholder, owner)
}

/**
 * @param {import('./models.mjs').chatMetadata_t} chatMetadata 会话元数据
 * @param {string} groupId 群 ID
 * @param {string} charname 角色名
 * @param {string | null | undefined} channelId 频道 ID
 * @returns {Promise<chatLogEntry_t>} 占位条目
 */
async function buildCharReplyPlaceholder(chatMetadata, groupId, charname, channelId) {
	const placeholder = new chatLogEntry_t()
	placeholder.role = 'char'
	placeholder.is_generating = true
	placeholder.extension.timeSlice = chatMetadata.LastTimeSlice.copy()
	delete placeholder.extension.timeSlice.greeting_type
	placeholder.time_stamp = new Date()
	const { info } = await getPartDetails(chatMetadata.username, `chars/${charname}`) || {}
	placeholder.name = info?.name || charname
	placeholder.avatar = info?.avatar
	placeholder.extension.timeSlice.charname = charname
	placeholder.content = ''
	placeholder.extension.groupChannelId = await resolveGroupChannelId(chatMetadata.username, groupId, channelId)
	return placeholder
}

/**
 * 触发指定角色在群频道内开始一次生成回复。
 * @param {string} groupId 群 ID
 * @param {string | null} channelId 频道 ID
 * @param {string | null} charname 角色名；为空时按频率随机
 * @param {object | null} [requestOverride] 合并进 `getChatRequest` 的字段
 * @param {object} [options] 额外选项
 * @param {string} [options.replicaUsername] 编排 replica
 * @param {object} [options.personaForOther] 跨机人格
 * @param {boolean} [options.fromRpc] 已在归属节点，跳过远端 RPC
 * @returns {Promise<void>}
 */
export async function triggerCharReply(groupId, channelId, charname, requestOverride = null, options = {}) {
	const chatMetadata = await ensureCharSession(groupId, channelId, charname)
	const { username } = chatMetadata

	if (!charname) {
		charname = pickNextCharForReply(
			(await getCharReplyFrequency(groupId)).filter(entry => entry.charname != null),
		)
		if (!charname) return
	}

	const session = await getMaterializedSession(username, groupId)
	const bind = getCharBind(session, charname)
	if (!bind) throw httpError(404, 'char not found')

	if (!options.fromRpc && !isLocalNode(bind.homeNodeHash, username)) {
		const personaForOther = session.personas?.[username]
			? { ownerUsername: username, personaname: session.personas[username] }
			: undefined
		const owner = bind.ownerUsername || username
		await invokeGroupRpc(groupId, username, {
			memberId: `${owner}:${charname}`,
			method: 'GetReply',
			args: [buildSerializableRequest({
				groupId,
				channelId,
				charname,
				replicaUsername: owner,
				personaForOther,
			})],
			targetNodeId: bind.homeNodeHash,
			partKind: 'char',
		})
		return
	}

	const char = chatMetadata.LastTimeSlice.chars[charname]
		|| await resolveChar(groupId, charname, username)
	if (!char) throw httpError(404, 'char not found')

	const flightKey = charReplyFlightKey(groupId, channelId, charname)
	if (charReplyInFlight.has(flightKey)) return
	charReplyInFlight.add(flightKey)

	const placeholder = await buildCharReplyPlaceholder(chatMetadata, groupId, charname, channelId)
	const owner = groupMetadatas.get(groupId)?.username

	try {
		const request = await getChatRequest(groupId, charname, channelId, {
			replicaUsername: options.replicaUsername || username,
			personaForOther: options.personaForOther,
		})
		if (requestOverride)
			Object.assign(request, requestOverride)

		if (owner) {
			const { resolveLocalEventSigner } = await import('../dag/localSigner.mjs')
			const { checkMessageRateLimit } = await import('../governance/messageRateLimit.mjs')
			const { appendLocalSystemChatLog } = await import('./localSystemLog.mjs')
			const { state } = await getState(username, groupId)
			const { sender } = await resolveLocalEventSigner(username, groupId)
			const rate = await checkMessageRateLimit(username, groupId, state, {
				type: 'message',
				channelId,
				sender,
				charId: charname,
				content: { type: 'text', content: '' },
				hlc: { wall: Date.now() },
			})
			if (!rate.ok) {
				const text = `角色 ${charname} 已达到本群消息限速，本次未写入 DAG。`
				await appendLocalSystemChatLog(groupId, channelId, text)
				charReplyInFlight.delete(flightKey)
				return
			}
			await appendDagGeneratingPlaceholder(groupId, placeholder, owner)
		}

		const stream = createGenerationStream(
			groupId,
			placeholder.id,
			placeholder.extension?.dagEventId || null,
		)

		void executeGeneration(groupId, request, stream, placeholder, chatMetadata)
			.catch(err => {
				console.error('executeGeneration error:', err)
				charReplyInFlight.delete(flightKey)
			})
	}
	catch (error) {
		await rollbackCharReplySetup(groupId, placeholder, owner)
		charReplyInFlight.delete(flightKey)
		throw error
	}
}

/**
 * @param {unknown} value 错误或其它值
 * @returns {string} 诊断字符串
 */
function formatGenerationError(value) {
	if (value instanceof Error) return value.stack || value.message || inspect(value)
	if (Array.isArray(value)) return value.map(formatGenerationError).join('\n---\n')
	return inspect(value)
}

/**
 * @param {AsyncIterable<object>} iterable 异步迭代器
 * @returns {Promise<object[]>} 收集的轮次列表
 */
async function collectAsyncIterable(iterable) {
	const out = []
	for await (const item of iterable) out.push(item)
	return out
}
