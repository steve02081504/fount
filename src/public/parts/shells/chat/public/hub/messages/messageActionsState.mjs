/**
 * 【文件】public/hub/messages/messageActionsState.mjs
 * 【职责】消息操作模块的共享上下文：当前频道消息快照、反馈编辑队列与删除任务串行化。
 * 【原理】`showFeedbackReasonInput` 在消息行下插入原因输入；`restoreActiveFeedbackEdits` 在重绘后恢复；`appendChannelActionMessage` 向上下文追加乐观行。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../../scripts/template、../core/domUtils。
 */
import { renderTemplate } from '../../../../../scripts/template.mjs'
import { escapeHtml } from '../../src/lib/escapeHtml.mjs'
/** @type {object | null} */
let channelActionsCtx = null

/** @type {Promise<void>} */
let deletionQueue = Promise.resolve()

/** @type {Map<string, { type: 'up' | 'down', inputValue: string }>} */
export const activeFeedbackEdits = new Map()

/**
 * 更新频道消息操作委托上下文。
 * @param {object} actions 含 groupId、channelId、messages、reload
 * @returns {void}
 */
export function setChannelMessageActionsContext(actions) {
	channelActionsCtx = actions
}

/**
 * @returns {object | null} 当前操作上下文
 */
export function getChannelMessageActionsContext() {
	return channelActionsCtx
}

/**
 * 向当前操作上下文追加一条消息行（流式追加时保持编辑/反馈可解析）。
 * @param {object} message 消息行
 * @returns {void}
 */
export function appendChannelActionMessage(message) {
	if (!channelActionsCtx) return
	const list = channelActionsCtx.messages
	channelActionsCtx.messages = Array.isArray(list) ? [...list, message] : [message]
}

/**
 * @param {HTMLElement} row 消息行
 * @param {object} actions 操作上下文
 * @returns {object | undefined} 匹配的消息行
 */
export function findContextMessage(row, actions) {
	if (!row || !actions.messages?.length) return undefined
	const messageId = row.getAttribute('data-message-id')
	const entryId = row.getAttribute('data-entry-id')
	const logIndex = row.getAttribute('data-log-index')
	return actions.messages.find(message =>
		(logIndex != null && logIndex !== '' && String(message.chatLogIndex) === logIndex)
		|| (messageId && String(message.eventId) === messageId)
		|| (entryId && String(message.id) === entryId),
	)
}

/**
 * @param {() => Promise<void>} task 删除任务
 * @returns {void}
 */
export function enqueueDeletion(task) {
	deletionQueue = deletionQueue.then(task).catch(error => console.error('deletion queue', error))
}

/**
 * @param {HTMLElement|null} row 消息行
 * @param {string} eventId DAG 事件 id
 * @param {'up'|'down'} type 反馈类型
 * @returns {void}
 */
export async function showFeedbackReasonInput(row, eventId, type) {
	if (!row || row.querySelector('.hub-message-feedback-reason-area')) return
	activeFeedbackEdits.set(eventId, { type, inputValue: '' })
	const reasonWrap = document.createElement('div')
	reasonWrap.className = 'hub-message-feedback-reason-area'
	reasonWrap.dataset.eventId = eventId
	reasonWrap.dataset.feedbackType = type
	reasonWrap.appendChild(await renderTemplate('hub/messages/feedback_reason', {
		eventId: escapeHtml(eventId),
	}))
	row.querySelector('.chat, .hub-message-body')?.appendChild(reasonWrap)
	requestAnimationFrame(() => { reasonWrap.classList.add('visible') })
	const textarea = reasonWrap.querySelector('textarea')
	if (textarea instanceof HTMLTextAreaElement) {
		textarea.addEventListener('input', () => {
			const edit = activeFeedbackEdits.get(eventId)
			if (edit) edit.inputValue = textarea.value
		})
		textarea.focus()
	}
}

/**
 * 重载消息后恢复未提交的反馈原因输入框。
 * @param {HTMLElement} container 消息列表根
 * @returns {void}
 */
export function restoreActiveFeedbackEdits(container) {
	if (!(container instanceof HTMLElement) || !activeFeedbackEdits.size) return
	for (const [eventId, edit] of activeFeedbackEdits) {
		const row = container.querySelector(
			`[data-dag-event-id="${CSS.escape(eventId)}"], [data-message-id="${CSS.escape(eventId)}"]`,
		)
		if (!(row instanceof HTMLElement)) continue
		void showFeedbackReasonInput(row, eventId, edit.type)
		const area = row.querySelector('.hub-message-feedback-reason-area')
		const textarea = area?.querySelector('textarea')
		if (textarea instanceof HTMLTextAreaElement)
			textarea.value = edit.inputValue || ''
	}
}
