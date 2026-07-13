import { getState } from '../dag/materialize.mjs'

import { postBridgeMessage } from './ingress.mjs'
import { listBridgeGroupMappings, ensureBridgeGroup } from './registry.mjs'

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
 * @param {object} messageLine DAG 消息行
 * @param {string} charname 角色名
 * @returns {object} chatLogEntry 形状
 */
export function messageLineToReplyEntry(messageLine, charname) {
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
 * @param {Set<string>} outboundRegistered 已注册出站 handler 的群 ID 集合
 * @param {string} ownerUsername replica
 */
export function primeOutboundRegistered(outboundRegistered, ownerUsername) {
	for (const { groupId } of listBridgeGroupMappings(ownerUsername))
		outboundRegistered.add(groupId)
}

/**
 * 入站 DTO 写入 DAG 并在需要时注册出站 handler。
 * @param {string} ownerUsername replica
 * @param {import('../../../../../../decl/charAPI.ts').CharAPI_t} charAPI 角色 API
 * @param {'discord' | 'telegram' | 'wechat'} platform 平台
 * @param {object} dto 桥接 DTO
 * @param {(groupId: string, bridge: object) => Promise<void>} ensureOutboundHandler 出站注册
 * @returns {Promise<void>}
 */
export async function bridgeIngestDto(ownerUsername, charAPI, platform, dto, ensureOutboundHandler) {
	await charAPI.interfaces[platform]?.TweakInboundDto?.(dto)
	await postBridgeMessage(ownerUsername, dto)
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
