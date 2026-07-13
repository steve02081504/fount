import { getState } from '../dag/materialize.mjs'

import { postBridgeMessage } from './ingress.mjs'
import { ensureBridgeGroup } from './registry.mjs'

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
 * 入站 DTO 写入 DAG 并在需要时注册出站 handler。
 * @param {string} ownerUsername replica
 * @param {import('../../../../../../decl/charAPI.ts').CharAPI_t} charAPI 角色 API
 * @param {'discord' | 'telegram' | 'wechat'} platform 平台
 * @param {object} dto 桥接 DTO
 * @param {(groupId: string, bridge: object, sourceDto: object) => Promise<void>} ensureOutboundHandler 出站注册
 * @param {string} [botname] 服务该群的 bot 实例名
 * @param {string} [charname] 绑定进桥接群的角色名（幂等 addchar）
 * @returns {Promise<void>}
 */
export async function bridgeIngestDto(ownerUsername, charAPI, platform, dto, ensureOutboundHandler, botname, charname) {
	await charAPI.interfaces[platform]?.TweakInboundDto?.(dto)
	if (botname) dto.botname = botname
	const { groupId } = await ensureBridgeGroup(ownerUsername, {
		platform: dto.platform,
		platformChatId: dto.platformChatId,
		chatKind: dto.chatKind,
		name: dto.chatName,
		botname,
	})
	if (charname) {
		const { addchar } = await import('../session/partConfig.mjs')
		await addchar(groupId, charname, ownerUsername)
	}
	await postBridgeMessage(ownerUsername, dto)
	const { state } = await getState(ownerUsername, groupId)
	if (state.groupSettings?.bridge)
		await ensureOutboundHandler(groupId, state.groupSettings.bridge, dto)
}
