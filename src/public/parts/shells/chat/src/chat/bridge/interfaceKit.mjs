/**
 * bot 壳共用入站套件（虚拟会话，不建真实 chat 群）。
 */
import {
	appendVirtualBridgeMessage,
	deleteVirtualBridgeMessage,
	editVirtualBridgeMessage,
	ensureVirtualBridgeSession,
	isVirtualBridgeBackfilled,
	markVirtualBridgeBackfilled,
	virtualBridgeChannelId,
} from './session.mjs'
import { runVirtualBridgeTrigger } from './trigger.mjs'

/**
 * @param {Function} func 异步函数
 * @param {{ times?: number, WhenFailsWaitFor?: number }} [options] 重试选项
 * @returns {Promise<unknown>} 最后一次成功调用的返回值
 */
export async function tryFewTimes(func, { times = 3, WhenFailsWaitFor = 2000 } = {}) {
	let lastError
	for (let i = 0; i < times; i++) try {
		return await func()
	}
	catch (error) {
		lastError = error
		if (i < times - 1) await new Promise(resolve => setTimeout(resolve, WhenFailsWaitFor))
	}
	throw lastError
}

/**
 * @param {object} messageLine 虚拟 log / 出站行
 * @param {string} charname 角色名
 * @returns {object} chatLogEntry 形状（FormatOutboundReply 用）
 */
export function messageLineToReplyEntry(messageLine, charname) {
	const text = typeof messageLine?.content === 'string'
		? messageLine.content
		: String(messageLine?.content?.content ?? messageLine?.content?.text ?? '')
	return {
		name: charname,
		role: 'char',
		content: text,
		content_for_show: text,
		time_stamp: messageLine?.time_stamp || messageLine?.hlc?.wall || Date.now(),
		files: (messageLine?.files || []).map(file => ({
			name: file.name,
			mime_type: file.mime_type,
			buffer: file.buffer,
			description: file.description || '',
		})),
		extension: { virtualEventId: messageLine?.extension?.virtualEventId || messageLine?.eventId },
	}
}

/**
 * 入站 DTO → 虚拟会话 → OnMessage/GetReply。
 * @param {string} ownerUsername replica
 * @param {import('../../../../../../decl/charAPI.ts').CharAPI_t} charAPI 角色 API
 * @param {'discord' | 'telegram' | 'wechat'} platform 平台
 * @param {object} dto 桥接 DTO
 * @param {(groupId: string, bridge: object, sourceDto: object) => Promise<void>} ensureOutboundHandler 出站注册
 * @param {string} [botname] bot 实例名
 * @param {string} [charname] 角色名
 * @returns {Promise<{ groupId: string }>} 虚拟群 ID
 */
export async function bridgeIngestDto(ownerUsername, charAPI, platform, dto, ensureOutboundHandler, botname, charname) {
	await charAPI.interfaces[platform]?.TweakInboundDto?.(dto)
	if (botname) dto.botname = botname
	const session = ensureVirtualBridgeSession(ownerUsername, {
		platform: dto.platform || platform,
		platformChatId: dto.platformChatId,
		chatKind: dto.chatKind,
		name: dto.chatName,
		botname,
		charname,
	})
	const channelId = virtualBridgeChannelId(dto.platformThreadId)
	// 先注册出站并完成历史回填，再写入触发消息，保证 chat_log.at(-1) 是最新消息
	await ensureOutboundHandler(session.groupId, {
		platform: session.platform,
		platformChatId: session.platformChatId,
		chatKind: session.chatKind,
		botname: session.botname,
	}, dto)
	const { entry } = await appendVirtualBridgeMessage(ownerUsername, dto)
	if (charname)
		void runVirtualBridgeTrigger(ownerUsername, session.groupId, channelId, entry, charAPI, charname)
			.catch(error => console.error('[bridge] virtual trigger failed:', error))
	return { groupId: session.groupId }
}

/**
 * 入站编辑。
 * @param {string} username replica
 * @param {object} dto 编辑 DTO
 * @returns {Promise<object | null>} 结果
 */
export async function postBridgeEdit(username, dto) {
	return editVirtualBridgeMessage(username, dto)
}

/**
 * 入站删除。
 * @param {string} username replica
 * @param {object} dto 删除 DTO
 * @returns {Promise<boolean>} 是否删除
 */
export async function postBridgeDelete(username, dto) {
	return deleteVirtualBridgeMessage(username, dto)
}

/**
 * 入站消息（兼容旧名；不触发回复，仅写 log——完整链路请用 bridgeIngestDto）。
 * @param {string} username replica
 * @param {object} dto DTO
 * @returns {Promise<object>} entry
 */
export async function postBridgeMessage(username, dto) {
	const { entry, session } = await appendVirtualBridgeMessage(username, dto)
	return { id: entry.extension.virtualEventId, groupId: session.groupId, entry }
}

/**
 *
 */
export {
	isVirtualBridgeBackfilled as isBridgeGroupBackfilled,
	markVirtualBridgeBackfilled as markBridgeGroupBackfilled,
}
