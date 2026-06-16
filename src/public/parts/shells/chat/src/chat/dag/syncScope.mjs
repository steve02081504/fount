/**
 * 【文件】`dag/syncScope.mjs` — 频道懒同步范围过滤。
 * 【职责】判定 `syncScope:channel` 下哪些事件纳入频道增量同步切片。
 * 【原理】懒同步仅透传目标频道相关的消息类事件，`list_item_update` 按 `content.channelId` 匹配。
 * 【数据结构】`CHANNEL_SYNC_MESSAGE_TYPES` 为可过滤的消息相关 type 集合。
 * 【关联】`queries.mjs`、`sessionEventValidate.mjs`。
 */
import { resolveChannelId } from '../lib/channelId.mjs'

/** 懒同步频道时纳入切片的消息类事件；其余类型在 `syncScope:channel` 下排除。 */
const CHANNEL_SYNC_MESSAGE_TYPES = new Set([
	'message',
	'message_edit',
	'message_delete',
	'message_feedback',
	'vote_cast',
	'reaction_add',
	'reaction_remove',
	'pin_message',
	'unpin_message',
])

/**
 * `syncScope:'channel'` 下是否应将该事件纳入对该频道的增量同步切片。
 * @param {object} event 事件
 * @param {string} channelId 目标频道
 * @returns {boolean} 是否纳入懒同步切片
 */
export function eventMatchesLazyChannelScope(event, channelId) {
	const eventType = event.type
	if (eventType === 'list_item_update')
		return event.content?.channelId?.trim() === channelId
	if (!CHANNEL_SYNC_MESSAGE_TYPES.has(eventType)) return false
	return resolveChannelId(event.channelId) === channelId
}

