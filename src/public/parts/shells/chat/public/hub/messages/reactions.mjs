/**
 * 【文件】public/hub/messages/reactions.mjs
 * 【职责】消息反应（emoji）点击委托：在频道视图容器上切换添加/移除反应并刷新反应条。
 * 【原理】`wireMessageReactions` 监听 `.hub-message-reaction` 点击，更新行内反应计数与选中态。依赖 `messageRender.renderMessageReactionsHtml` 已渲染的按钮；本地乐观更新后可触发频道刷新。
 * 【数据结构】见函数入参与返回值 JSDoc。
 * 【关联】../../../../../scripts/i18n、../../src/ui/channelDisplay、../../src/ui/emojiPicker、../../src/ui/reactionHandlers
 */
import { promptI18n } from '../../../../../scripts/i18n/index.mjs'
import { tallyReactionVotersFromMap } from '../../src/ui/channelDisplay.mjs'
import { showEmojiPicker } from '../../src/ui/emojiPicker.mjs'
import { createReactionHandlers } from '../../src/ui/reactionHandlers.mjs'

/** 已绑定过事件的按钮元素集合，避免 wireMessageReactions 多次调用重复绑定。 */
const wiredButtons = new WeakSet()

/**
 * 为 Hub 消息列表绑定表情回应点击（含管理员 contextmenu 代删）。
 * @param {HTMLElement} container `#hub-messages` 根节点
 * @param {object} channelView 频道视图上下文
 * @param {string} channelView.groupId 群 ID
 * @param {string} channelView.channelId 频道 ID
 * @param {object[]} channelView.messages 当前频道消息行
 * @param {Record<string, Record<string, { voters?: string[] }>>} channelView.reactions 当前页聚合反应
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
		reactions = {},
		viewerMemberId = 'local',
		canManageMessages = false,
		reload,
	} = channelView
	const { toggleReaction } = createReactionHandlers({ groupId, channelId })

	container.querySelectorAll('.hub-reactions [data-action="reaction"]').forEach(reactionButton => {
		if (!(reactionButton instanceof HTMLButtonElement)) return
		if (wiredButtons.has(reactionButton)) return
		wiredButtons.add(reactionButton)
		const eventId = reactionButton.getAttribute('data-event-id')
		const emoji = reactionButton.getAttribute('data-emoji')
		if (!eventId || !emoji) return
		reactionButton.addEventListener('click', async event => {
			event.stopPropagation()
			if (reactionButton.disabled) return
			const byMe = reactionButton.classList.contains('badge-primary')
			reactionButton.disabled = true
			reactionButton.setAttribute('aria-busy', 'true')
			try {
				await toggleReaction(eventId, emoji, byMe)
				await reload()
			}
			finally {
				reactionButton.disabled = false
				reactionButton.removeAttribute('aria-busy')
			}
		})
		if (canManageMessages)
			reactionButton.addEventListener('contextmenu', async event => {
				event.preventDefault()
				const voters = tallyReactionVotersFromMap(reactions, eventId, viewerMemberId)
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
		if (wiredButtons.has(addReactionButton)) return
		wiredButtons.add(addReactionButton)
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
