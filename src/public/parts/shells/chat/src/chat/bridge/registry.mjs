import { prefixedRandomId } from 'npm:@steve02081504/fount-p2p/core/random_id'

import { appendSignedLocalEvent } from '../dag/append.mjs'
import { newGroup } from '../session/crud.mjs'

import {
	bridgeGroupKey,
	loadBridgesDoc,
	saveBridgesDoc,
} from './store.mjs'

const MESSAGE_MAP_MAX = 500

/**
 * @param {string} username replica
 * @param {string} groupKey 桥接群键
 * @returns {object | null} 映射行或 null
 */
export function getBridgeGroupMapping(username, groupKey) {
	return loadBridgesDoc(username).mappings[groupKey] || null
}

/**
 * 确保平台会话映射到 fount 群（不存在则建群并写 bridge 标记）。
 * @param {string} username replica
 * @param {{ platform: string, platformChatId: string | number, chatKind?: 'dm' | 'group', name?: string }} args 参数
 * @returns {Promise<{ groupId: string, mapping: object }>} 群 ID 与映射行
 */
export async function ensureBridgeGroup(username, { platform, platformChatId, chatKind = 'group', name }) {
	const key = bridgeGroupKey(platform, platformChatId)
	const doc = loadBridgesDoc(username)
	let mapping = doc.mappings[key]
	if (mapping?.groupId) {
		if (!mapping.channels) mapping.channels = { default: 'default' }
		if (!mapping.messageMap) mapping.messageMap = []
		return { groupId: mapping.groupId, mapping }
	}

	const groupId = await newGroup(username, { name: name || `${platform}:${platformChatId}` })
	await appendSignedLocalEvent(username, groupId, {
		type: 'group_settings_update',
		timestamp: Date.now(),
		content: {
			bridge: {
				platform: String(platform),
				platformChatId: String(platformChatId),
				chatKind,
			},
		},
	})

	mapping = {
		groupId,
		channels: { default: 'default' },
		messageMap: [],
	}
	doc.mappings[key] = mapping
	saveBridgesDoc(username, doc)
	return { groupId, mapping }
}

/**
 * 解析桥接频道（thread 未映射则建子频道）。
 * @param {string} username replica
 * @param {{ platform: string, platformChatId: string | number, platformThreadId?: string | number }} args 参数
 * @returns {Promise<{ groupId: string, channelId: string }>} 群与频道 ID
 */
export async function resolveBridgeChannel(username, { platform, platformChatId, platformThreadId }) {
	const key = bridgeGroupKey(platform, platformChatId)
	const doc = loadBridgesDoc(username)
	const mapping = doc.mappings[key]
	if (!mapping?.groupId) throw new Error(`bridge group not mapped: ${key}`)

	const threadKey = platformThreadId != null && String(platformThreadId).trim() !== ''
		? String(platformThreadId)
		: 'default'

	let channelId = mapping.channels?.[threadKey]
	if (channelId) return { groupId: mapping.groupId, channelId }

	if (threadKey === 'default') 
		channelId = 'default'
	
	else {
		channelId = prefixedRandomId('channel_')
		await appendSignedLocalEvent(username, mapping.groupId, {
			type: 'channel_create',
			timestamp: Date.now(),
			content: {
				channelId,
				name: `thread:${threadKey}`,
				type: 'text',
			},
		})
	}

	mapping.channels ??= {}
	mapping.channels[threadKey] = channelId
	doc.mappings[key] = mapping
	saveBridgesDoc(username, doc)
	return { groupId: mapping.groupId, channelId }
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {string | null} 桥接群键
 */
export function findBridgeGroupKeyByGroupId(username, groupId) {
	const doc = loadBridgesDoc(username)
	for (const [key, mapping] of Object.entries(doc.mappings))
		if (mapping?.groupId === groupId) return key
	return null
}

/**
 * 记录 fount eventId ↔ 平台 messageId 对。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {{ eventId: string, platformMessageId: string | number }} pair 映射对
 * @returns {Promise<void>}
 */
export async function recordBridgeMessagePair(username, groupId, { eventId, platformMessageId }) {
	const key = findBridgeGroupKeyByGroupId(username, groupId)
	if (!key) return
	const doc = loadBridgesDoc(username)
	const mapping = doc.mappings[key]
	if (!mapping) return
	mapping.messageMap ??= []
	mapping.messageMap.push({
		eventId: String(eventId).trim().toLowerCase(),
		platformMessageId: String(platformMessageId),
	})
	if (mapping.messageMap.length > MESSAGE_MAP_MAX)
		mapping.messageMap = mapping.messageMap.slice(-MESSAGE_MAP_MAX)
	doc.mappings[key] = mapping
	saveBridgesDoc(username, doc)
}

/**
 * 按平台 messageId 查 fount eventId。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string | number} platformMessageId 平台消息 ID
 * @returns {string | null} eventId
 */
export function lookupBridgeEventId(username, groupId, platformMessageId) {
	const key = findBridgeGroupKeyByGroupId(username, groupId)
	if (!key) return null
	const needle = String(platformMessageId)
	const mapping = loadBridgesDoc(username).mappings[key]
	if (!mapping?.messageMap?.length) return null
	for (let i = mapping.messageMap.length - 1; i >= 0; i--) {
		const row = mapping.messageMap[i]
		if (String(row.platformMessageId) === needle)
			return String(row.eventId).trim().toLowerCase()
	}
	return null
}

/**
 * 枚举本 replica 已映射的桥接群。
 * @param {string} username replica
 * @returns {Array<{ groupKey: string, groupId: string }>} 已映射桥接群列表
 */
export function listBridgeGroupMappings(username) {
	const doc = loadBridgesDoc(username)
	return Object.entries(doc.mappings).map(([groupKey, mapping]) => ({
		groupKey,
		groupId: mapping.groupId,
	}))
}
