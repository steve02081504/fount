import { resolveBridgeIdentity } from './identity.mjs'
import { resolveBridgeChannel } from './registry.mjs'

const TYPING_TTL_MS = 6000

/** @type {Map<string, Map<string, number>>} `${username}:${groupId}:${channelId}` → entityHash → expiresAt */
const typingByChannel = new Map()

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {string} 存储键
 */
function channelKey(username, groupId, channelId) {
	return `${username}:${groupId}:${String(channelId || 'default').trim() || 'default'}`
}

/**
 * @param {Map<string, number>} bucket entityHash → expiresAt
 * @param {number} now 当前时间戳
 */
function pruneBucket(bucket, now) {
	for (const [hash, expiresAt] of bucket.entries())
		if (expiresAt <= now) bucket.delete(hash)
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} entityHash 正在输入的实体
 */
export function recordChannelTyping(username, groupId, channelId, entityHash) {
	const hash = String(entityHash || '').trim().toLowerCase()
	if (!hash) return
	const key = channelKey(username, groupId, channelId)
	let bucket = typingByChannel.get(key)
	if (!bucket) {
		bucket = new Map()
		typingByChannel.set(key, bucket)
	}
	const now = Date.now()
	pruneBucket(bucket, now)
	bucket.set(hash, now + TYPING_TTL_MS)
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {string[]} 当前正在输入的 entityHash 列表
 */
export function listTypingEntities(username, groupId, channelId) {
	const key = channelKey(username, groupId, channelId)
	const bucket = typingByChannel.get(key)
	if (!bucket?.size) return []
	const now = Date.now()
	pruneBucket(bucket, now)
	if (!bucket.size) typingByChannel.delete(key)
	return [...bucket.keys()]
}

/**
 * 桥接平台 typing 事件入账（不进 DAG）。
 * @param {string} username replica
 * @param {{ platform: string, platformChatId: string | number, platformThreadId?: string | number, platformUserId: string | number, displayName?: string }} dto 平台 typing
 * @returns {Promise<void>}
 */
export async function postBridgeTyping(username, dto) {
	const { groupId, channelId } = await resolveBridgeChannel(username, {
		platform: dto.platform,
		platformChatId: dto.platformChatId,
		platformThreadId: dto.platformThreadId,
	})
	const entityHash = await resolveBridgeIdentity(username, dto.platform, dto.platformUserId, dto.displayName)
	recordChannelTyping(username, groupId, channelId, entityHash)
}
