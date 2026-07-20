/**
 * checkpoint `hot_posts` 索引：每频道最新 N + pin ±N。
 */
import { readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'

import { messagesPath } from '../lib/paths.mjs'

/**
 *
 */
export {
	allProtectedHotEventIds,
	listChannelMessageEvents,
	overlayPinsForChannel,
	protectedHotEventIds,
	recomputeHotPostIndex,
} from './hotPostsIndex.mjs'

import { recomputeHotPostIndex } from './hotPostsIndex.mjs'

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} state 物化状态
 * @param {object[]} events DAG 事件
 * @returns {Promise<object>} hot_posts
 */
export async function computeHotPostsForCheckpoint(username, groupId, state, events) {
	void username
	void groupId
	return recomputeHotPostIndex(state, events, state.groupSettings)
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {Set<string>} protectedIds 保留 id
 * @returns {Promise<object[]>} 待保留行
 */
export async function filterHotMessageLines(username, groupId, channelId, protectedIds) {
	const lines = await readJsonl(messagesPath(username, groupId, channelId), { sanitize: stripDagEventLocalExtensions })
	return lines.filter(row => protectedIds.has(String(row.eventId).trim()))
}
