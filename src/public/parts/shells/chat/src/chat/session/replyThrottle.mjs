/** @typedef {import('../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */

import { buildChatLogEntriesFromChannelLines, loadDagHydrationI18n } from '../dag/hydration.mjs'
import { getState } from '../dag/materialize.mjs'
import { buildConversationContext } from '../lib/conversationContext.mjs'

import { getChatRequest } from './chatRequest.mjs'
import { getGroupRuntime } from './runtime.mjs'

/** @type {Map<string, { tokens: number }>} 角色自动回复桶状态 */
const autoReplyBuckets = new Map()

/** groupId+channelId → 定频触发计数 */
const autoReplyFrequencyByChannel = new Map()

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} charname 角色名
 * @returns {string} token bucket 键
 */
export function autoReplyBucketKey(groupId, channelId, charname) {
	return `${groupId}\0${channelId || 'default'}\0${charname}`
}

/**
 * @param {string} bucketKey token bucket 键
 * @param {{ enabled: boolean, burst: number, refill: number }} settings 桶配置
 * @returns {{ allowed: boolean, row: { tokens: number } }} 是否允许消耗
 */
export function consumeAutoReplyToken(bucketKey, settings) {
	if (!settings.enabled) return { allowed: true, row: { tokens: settings.burst } }
	const row = autoReplyBuckets.get(bucketKey) || { tokens: settings.burst }
	row.tokens = Math.min(settings.burst, row.tokens + settings.refill)
	if (row.tokens < 1) {
		autoReplyBuckets.set(bucketKey, row)
		return { allowed: false, row }
	}
	row.tokens = Math.max(0, row.tokens - 1)
	autoReplyBuckets.set(bucketKey, row)
	return { allowed: true, row }
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<{ enabled: boolean, burst: number, refill: number, frequency: number }>} 节流配置
 */
export async function loadAutoReplySettings(username, groupId) {
	const { state } = await getState(username, groupId)
	const refillRaw = Number(state?.groupSettings?.autoReplyTokenRefillPerMessage)
	return {
		enabled: !!state?.groupSettings?.autoReplyTokenBucketEnabled,
		burst: Math.max(1, Number(state?.groupSettings?.autoReplyTokenBurst) || 2),
		refill: Number.isFinite(refillRaw) ? Math.max(0, refillRaw) : 0.5,
		frequency: Number(state?.groupSettings?.autoReplyFrequency) || 0,
	}
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {number} frequency 定频 N
 * @returns {boolean} 是否到达定频阈值
 */
export function tickAutoReplyFrequency(groupId, channelId, frequency) {
	if (frequency <= 0) return false
	const trackerKey = `${groupId}\0${channelId}`
	let tracker = autoReplyFrequencyByChannel.get(trackerKey)
	if (!tracker) {
		tracker = { messageCount: 0 }
		autoReplyFrequencyByChannel.set(trackerKey, tracker)
	}
	if (++tracker.messageCount < frequency) return false
	tracker.messageCount = 0
	return true
}

/**
 * 构建 onMessage 事件体（可序列化；供入站管线与链式轮询共用）。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} charname 角色名
 * @param {{ messageLine?: object, mentions?: object }} [options] 触发消息与 mentions
 * @returns {Promise<object>} onMessage 事件
 */
export async function buildOnMessageEvent(username, groupId, channelId, charname, options = {}) {
	const { group, channel } = await buildConversationContext(username, groupId, channelId)
	const chatReplyRequest = await getChatRequest(groupId, charname, channelId, { replicaUsername: username })
	let message = chatReplyRequest.chat_log?.at(-1)
	if (options.messageLine) {
		const chatMetadata = await getGroupRuntime(groupId, username)
		const i18n = await loadDagHydrationI18n()
		const entries = await buildChatLogEntriesFromChannelLines(
			[options.messageLine],
			chatMetadata.LastTimeSlice,
			i18n,
			channelId,
			username,
			groupId,
		)
		if (entries.length) message = entries[entries.length - 1]
	}
	return {
		chatReplyRequest,
		message,
		mentions: options.mentions || { entityHashes: [], roleIds: [], everyone: false },
		group,
		channel,
	}
}
