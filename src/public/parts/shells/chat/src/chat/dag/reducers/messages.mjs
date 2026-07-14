import { isVoteBallotClosed } from '../../lib/voteBallots.mjs'

import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { withGroupId } from './state.mjs'

/** @type {Record<string, (state: object, event: object) => object>} */
export const messageReducers = {
	/**
	 * 处理 `message` 事件：写入消息发送方索引（`messageSenderIndex`）。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	message(state, event) {
		withGroupId(state, event)
		const eventId = event.id
		const channelId = event.channelId || 'default'
		if (state.channels[channelId]) {
			state.channels[channelId].messageSeq = (Number(state.channels[channelId].messageSeq) || 0) + 1
			state.channels[channelId].lastEventId = eventId
		}
		if (isHex64(eventId)) 
			state.messageSenderIndex[eventId] = {
				sender: event.sender,
				charId: event.charId || null,
				channelId,
			}
		
		if (event.content?.type === 'vote') {
			state.voteBallots ??= {}
			state.voteBallots[eventId] = {
				channelId,
				deadline: event.content.deadline || null,
				question: event.content.question || '',
				options: event.content.options || [],
				sender: event.sender,
			}
		}
		return state
	},

	/**
	 * 处理 `message_delete` 事件：将目标消息 id 加入删除集合并清除发送方索引。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	message_delete(state, event) {
		withGroupId(state, event)
		const { targetId } = event.content
		state.messageOverlay.deletedIds.add(targetId)
		delete state.messageSenderIndex[targetId]
		if (state.voteBallots) delete state.voteBallots[targetId]
		return state
	},

	/**
	 * 处理 `message_edit` 事件：记录目标消息的最新编辑内容。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	message_edit(state, event) {
		withGroupId(state, event)
		const { targetId, newContent } = event.content
		state.messageOverlay.editHistory.set(targetId, newContent)
		return state
	},

	/**
	 * 处理 `message_feedback` 事件：记录目标消息的最新赞/踩反馈。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	message_feedback(state, event) {
		withGroupId(state, event)
		const { targetId, feedbackType, feedbackContent, charOwner } = event.content
		state.messageOverlay.feedbackHistory.set(targetId, {
			feedbackType,
			feedbackContent,
			charOwner,
			sender: event.sender,
		})
		return state
	},

	/**
	 * 处理 `reaction_add` 事件：为消息 emoji 追加投票者。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	reaction_add(state, event) {
		withGroupId(state, event)
		const { targetId, emoji } = event.content
		const key = `${targetId}:${emoji}`
		let voters = state.messageOverlay.reactions.get(key)
		if (!voters) {
			voters = new Set()
			state.messageOverlay.reactions.set(key, voters)
		}
		voters.add(event.sender)
		return state
	},

	/**
	 * 处理 `reaction_remove` 事件：从消息 emoji 移除投票者，空集时删除键。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	reaction_remove(state, event) {
		withGroupId(state, event)
		const { targetId, emoji, targetPubKeyHash } = event.content
		const key = `${targetId}:${emoji}`
		const voters = state.messageOverlay.reactions.get(key)
		if (!voters) return state
		// 撤销者：管理员代删时为 targetPubKeyHash，否则为事件签名者本人（自取消）。
		const voterKey = isHex64(targetPubKeyHash) ? targetPubKeyHash : event.sender
		voters.delete(voterKey)
		if (!voters.size) state.messageOverlay.reactions.delete(key)
		return state
	},

	/**
	 * 处理 `pin_message` 事件：将消息 id 追加到频道置顶列表。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	pin_message(state, event) {
		withGroupId(state, event)
		if (!state.messageOverlay.pins.has(event.channelId))
			state.messageOverlay.pins.set(event.channelId, [])
		const pins = state.messageOverlay.pins.get(event.channelId)
		if (!pins.includes(event.content.targetId))
			pins.push(event.content.targetId)
		return state
	},

	/**
	 * 处理 `unpin_message` 事件：从频道置顶列表移除消息 id。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	unpin_message(state, event) {
		withGroupId(state, event)
		if (state.messageOverlay.pins.has(event.channelId))
			state.messageOverlay.pins.set(
				event.channelId,
				state.messageOverlay.pins.get(event.channelId).filter(id => id !== event.content.targetId),
			)
		return state
	},

	/**
	 * 处理 `vote_cast` 事件：记录选票上的选民选择与选项。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	vote_cast(state, event) {
		withGroupId(state, event)
		const { ballotId, choice } = event.content
		const ballot = state.voteBallots?.[ballotId]
		if (isVoteBallotClosed(ballot, Number(event.hlc?.wall || event.timestamp || Date.now())))
			return state
		if (!state.messageOverlay.votes.has(ballotId))
			state.messageOverlay.votes.set(ballotId, new Map())
		state.messageOverlay.votes.get(ballotId).set(event.sender, String(choice))
		return state
	},
}
