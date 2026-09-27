/**
 * 虚拟桥接会话触发：OnMessage → GetReply → 出站 + typing。
 */
import { dispatchCharError } from '../session/charError.mjs'
import {
	autoReplyBucketKey,
	consumeAutoReplyToken,
} from '../session/replyThrottle.mjs'

import { requireBridgeOperation } from './operations.mjs'
import { notifyVirtualBridgeOutbound } from './outbound.mjs'
import { buildVirtualBridgeChatRequest, buildVirtualBridgeOnMessageEvent } from './request.mjs'
import { appendVirtualBridgeCharReply, getVirtualBridgeSession } from './session.mjs'
import { recordVirtualBridgeTyping } from './typing.mjs'
import { bridgeWakeKey, bridgeWakes } from './wake.mjs'

/**
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @param {string} channelId 频道 ID
 * @param {object} entry 触发消息
 * @param {import('../../../../../../../decl/charAPI.ts').CharAPI_t} charAPI 角色 API
 * @param {string} charname 角色名
 * @returns {Promise<void>}
 */
export async function runVirtualBridgeTrigger(username, groupId, channelId, entry, charAPI, charname) {
	if (entry.extension?.ingress === 'backfill') return
	if (entry.role === 'char') return

	const session = getVirtualBridgeSession(username, groupId)
	if (!session) return

	const event = await buildVirtualBridgeOnMessageEvent(
		username, session, channelId, entry, charname, charAPI,
	)

	let wantsReply = true
	if (charAPI.interfaces?.chat?.OnMessage)
		try {
			wantsReply = await charAPI.interfaces.chat.OnMessage(event)
		}
		catch (error) {
			await dispatchCharError(charAPI, error, {
				username,
				source: 'OnMessage',
				groupId,
				channelId,
				charname,
				event,
			})
			return
		}

	else {
		const isDm = session.chatKind === 'dm'
		const agentHash = event.chatReplyRequest.CharUid
		const mentioned = (event.mentions?.entityHashes || []).includes(String(agentHash))
		wantsReply = mentioned || isDm
	}

	if (!wantsReply) return

	const bucketKey = autoReplyBucketKey(groupId, channelId, charname)
	const { allowed } = consumeAutoReplyToken(bucketKey, {
		enabled: false,
		burst: 2,
		refill: 0.5,
	})
	if (!allowed) return

	// 入站消息在生成中直接丢弃（不排队）；生成结束后只补跑请求路径记下的唤醒
	const key = bridgeWakeKey(username, groupId, channelId, charname)
	if (!bridgeWakes.tryBegin(key)) return
	await runVirtualBridgeReplySlot(key, username, groupId, channelId, charname, charAPI, entry)
}

/**
 * 纯唤醒：请求本角色在虚拟会话至少再看一次权威日志。空闲立即生成；生成中记下唤醒，结束后补一次。
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @param {string} channelId 频道 ID
 * @param {string} charname 角色名
 * @param {import('../../../../../../../decl/charAPI.ts').CharAPI_t} charAPI 角色 API
 * @param {object} [triggerEntry] 触发消息行
 * @returns {Promise<void>}
 */
export async function requestVirtualBridgeReply(username, groupId, channelId, charname, charAPI, triggerEntry) {
	const key = bridgeWakeKey(username, groupId, channelId, charname)
	if (!bridgeWakes.tryBegin(key)) {
		bridgeWakes.mark(key)
		return
	}
	await runVirtualBridgeReplySlot(key, username, groupId, channelId, charname, charAPI, triggerEntry)
}

/**
 * 已成功 tryBegin 后的生成槽位：执行回复；结束后若期间记下未观察唤醒则补一次。
 * 不在此处 tryBegin，由调用方负责。
 * @param {string} key 槽位键
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @param {string} channelId 频道 ID
 * @param {string} charname 角色名
 * @param {import('../../../../../../../decl/charAPI.ts').CharAPI_t} charAPI 角色 API
 * @param {object} [triggerEntry] 触发消息行
 * @returns {Promise<void>}
 */
async function runVirtualBridgeReplySlot(key, username, groupId, channelId, charname, charAPI, triggerEntry) {
	try {
		const session = getVirtualBridgeSession(username, groupId)
		if (session)
			await executeVirtualBridgeReply(username, session, channelId, triggerEntry, charAPI, charname)
	}
	finally {
		if (bridgeWakes.release(key))
			void requestVirtualBridgeReply(username, groupId, channelId, charname, charAPI, triggerEntry)
	}
}

/**
 * @param {string} username replica
 * @param {object} session 虚拟会话
 * @param {string} channelId 频道 ID
 * @param {object} triggerEntry 触发消息
 * @param {import('../../../../../../../decl/charAPI.ts').CharAPI_t} charAPI 角色 API
 * @param {string} charname 角色名
 * @returns {Promise<void>}
 */
async function executeVirtualBridgeReply(username, session, channelId, triggerEntry, charAPI, charname) {
	const getReply = charAPI.interfaces?.chat?.GetReply
	if (!getReply) return

	const request = await buildVirtualBridgeChatRequest(
		username, session.groupId, channelId, charname, charAPI, triggerEntry,
	)

	const typingTimer = startTypingHeartbeat(username, session, channelId, request.CharUid)
	try {
		const reply = await getReply(request)
		if (!reply || (reply.content == null && !reply.files?.length)) return
		const { entry } = appendVirtualBridgeCharReply(
			username, session.groupId, channelId, reply, charname, request.CharUid,
		)
		await notifyVirtualBridgeOutbound(username, session.groupId, channelId, entry, charname)
	}
	catch (error) {
		await dispatchCharError(charAPI, error, {
			username,
			source: 'GetReply',
			groupId: session.groupId,
			channelId,
			charname,
		})
	}
	finally {
		clearInterval(typingTimer)
	}
}

/**
 * @param {string} username replica
 * @param {object} session 虚拟会话
 * @param {string} channelId 频道 ID
 * @param {string} charUid 角色 entityHash
 * @returns {ReturnType<typeof setInterval>} timer
 */
function startTypingHeartbeat(username, session, channelId, charUid) {
	/** 定时向虚拟桥接会话上报 typing。 */
	const pulse = () => {
		recordVirtualBridgeTyping(username, session.groupId, channelId, charUid)
		if (!session.botname) return
		try {
			const sendTyping = requireBridgeOperation(username, {
				platform: session.platform,
				botname: session.botname,
			}, 'sendTyping')
			void sendTyping({
				platformChatId: session.platformChatId,
				...channelId !== 'default' ? { platformThreadId: channelId } : {},
			}).catch(() => { /* platform typing best-effort */ })
		}
		catch { /* ops not registered yet */ }
	}
	pulse()
	return setInterval(pulse, 5000)
}
