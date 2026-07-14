/**
 * 群级消息发送限速：按用户 pubKeyHash 与 agent charId 分别计数。
 */
import { PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'
import { readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'
import { messageRateEntityKey } from 'npm:@steve02081504/fount-p2p/federation/message_rate_limit'

import { memberChannelPermissions } from '../dag/groupMaterializedState.mjs'
import { eventsPath } from '../lib/paths.mjs'

import {
	checkMessageRateLimitMemory,
	isRateLimitBucketRebuilt,
	rebuildRateLimitBucketFromTail,
} from './rateLimitState.mjs'

const TAIL_SCAN_MAX = 200

/**
 * @param {object} state 物化群状态
 * @param {string} senderPubKeyHash 事件 sender
 * @param {string} channelId 频道 ID
 * @returns {boolean} 是否可绕过限速
 */
export function hasBypassRateLimit(state, senderPubKeyHash, channelId) {
	const sender = senderPubKeyHash.trim().toLowerCase()
	if (!sender) return false
	const perms = memberChannelPermissions(state, sender, channelId)
	return !!perms[PERMISSIONS.BYPASS_RATE_LIMIT]
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} state 物化状态
 * @param {object} event 待发送 message 事件
 * @returns {Promise<{ ok: boolean, reason?: string }>} 是否允许发送
 */
export async function checkMessageRateLimit(username, groupId, state, event) {
	if (event?.type !== 'message') return { ok: true }
	const entityKey = messageRateEntityKey(event)
	if (!entityKey) return { ok: false, reason: 'missing sender' }
	const channelId = event.channelId || 'default'
	const senderHash = String(event.sender || '').trim().toLowerCase()
	if (hasBypassRateLimit(state, senderHash, channelId)) return { ok: true }

	if (!isRateLimitBucketRebuilt(username, groupId)) {
		const events = await readJsonl(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions })
		rebuildRateLimitBucketFromTail(username, groupId, events.slice(-TAIL_SCAN_MAX), state.groupSettings)
	}

	return checkMessageRateLimitMemory(username, groupId, state, event)
}
