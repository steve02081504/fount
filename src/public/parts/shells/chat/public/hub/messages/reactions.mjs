/**
 * 【文件】public/hub/messages/reactions.mjs
 * 【职责】消息反应（emoji）点击委托：在频道视图容器上切换添加/移除反应并刷新反应条。
 * 【原理】`wireMessageReactions` 监听 `.hub-message-reaction` 点击，更新行内反应计数与选中态。依赖 `messageRender.renderMessageReactionsHtml` 已渲染的按钮；本地乐观更新后可触发频道刷新。
 * 【数据结构】见函数入参与返回值 JSDoc。
 * 【关联】../../../../../scripts/i18n、../../src/ui/channelDisplay、../../src/ui/emojiPicker、../../src/ui/reactionHandlers
 */
import { promptI18n } from '../../../../../scripts/i18n.mjs'
import { tallyReactionVoters } from '../../src/ui/channelDisplay.mjs'
import { showEmojiPicker } from '../../src/ui/emojiPicker.mjs'
import { createReactionHandlers } from '../../src/ui/reactionHandlers.mjs'

/**
 * 为 Hub 消息列表绑定表情回应点击（含管理员 contextmenu 代删）。
 * @param {HTMLElement} container `#hub-messages` 根节点
 * @param {object} channelView 频道视图上下文
 * @param {string} channelView.groupId 群 ID
 * @param {string} channelView.channelId 频道 ID
 * @param {object[]} channelView.messages 当前频道消息行
 * @param {object[]} channelView.reactionEvents reaction DAG 行
 * @param {string} channelView.viewerMemberId 本机成员键
 * @param {boolean} channelView.canManageMessages 是否可代删他人 reaction
 * @param {() => Promise<void>} channelView.reload 操作后刷新消息列表
 * @returns {void}
 */
export function wireMessageReactions(container, channelView) {
	if (!(container instanceof HTMLElement)) return
	const {
		groupId,
		channelId,
		messages = [],
		reactionEvents = [],
		viewerMemberId = 'local',
		canManageMessages = false,
		reload,
	} = channelView
	const { toggleReaction } = createReactionHandlers({ groupId, channelId })
	const reactionTallyLines = [...messages, ...reactionEvents]

	container.querySelectorAll('.hub-reactions [data-action="reaction"]').forEach(reactionButton => {
		if (!(reactionButton instanceof HTMLButtonElement)) return
		const eventId = reactionButton.getAttribute('data-event-id')
		const emoji = reactionButton.getAttribute('data-emoji')
		if (!eventId || !emoji) return
		const byMe = reactionButton.classList.contains('badge-primary')
		reactionButton.addEventListener('click', async event => {
			event.stopPropagation()
			await toggleReaction(eventId, emoji, byMe)
			await reload()
		})
		if (canManageMessages)
			reactionButton.addEventListener('contextmenu', async event => {
				event.preventDefault()
				const voters = tallyReactionVoters(reactionTallyLines, eventId, viewerMemberId)
				const detail = voters.get(emoji)
				const otherVoters = (detail?.voters || []).filter(
					voterKey => voterKey !== viewerMemberId && voterKey !== 'local',
				)
				if (!otherVoters.length) return
				const pick = otherVoters.length === 1
					? otherVoters[0]
					: promptI18n('chat.hub.reactionRemovePrompt', {
						emoji,
						candidates: otherVoters.join('\n'),
					})
				if (!pick || !otherVoters.includes(pick)) return
				await toggleReaction(eventId, emoji, true, pick)
				await reload()
			})

	})

	container.querySelectorAll('.hub-reactions [data-action="addReaction"]').forEach(addReactionButton => {
		if (!(addReactionButton instanceof HTMLButtonElement)) return
		const eventId = addReactionButton.getAttribute('data-event-id')
		if (!eventId) return
		addReactionButton.addEventListener('click', event => {
			event.stopPropagation()
			void showEmojiPicker(event, emoji => {
				void toggleReaction(eventId, emoji, false).then(() => reload())
			})
		})
	})
}
