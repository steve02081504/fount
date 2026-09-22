/**
 * 【文件】public/src/lib/conversationItem.mjs — 会话条目渲染助手
 * 【职责】把会话摘要渲染为列表项，点击进入会话详情视图。
 * 【原理】复用 `conversation_item` 模板；键经 `requestNavigate('conversation', { key })` 交给导航层。
 * 【关联】templates/conversation_item.html、views/generations.mjs、lib/navigationEvents.mjs。
 */
import { geti18n, primaryLocale } from '/scripts/i18n/index.mjs'

import { renderTemplate } from '../templates.mjs'

import { bindActivate } from './activate.mjs'
import { formatTime, truncate } from './format.mjs'
import { requestNavigate } from './navigationEvents.mjs'

/**
 * 计算会话条目的显示字段。
 * @param {object} conversation 会话摘要
 * @returns {{ key: string, title: string, meta: string, count: string, badgeClass: string }} 字段
 */
function conversationFields(conversation) {
	const title = conversation.charname || conversation.charId || conversation.key
	return {
		key: conversation.key,
		title: truncate(title),
		meta: [
			conversation.source || '',
			geti18n('agent_studio.conversation.rounds', { count: conversation.requestCount ?? 0 }),
			formatTime(conversation.finishedAt ?? conversation.startedAt, primaryLocale()),
		].filter(Boolean).join(' · '),
		count: geti18n('agent_studio.conversation.generationsCount', { count: conversation.generationCount ?? 0 }),
		badgeClass: conversation.errorCount ? 'badge-error' : 'badge-ghost',
	}
}

/**
 * 渲染会话列表项并绑定进入详情。
 * @param {object} conversation 会话摘要
 * @returns {Promise<HTMLElement>} 列表项
 */
export async function renderConversationItem(conversation) {
	const item = await renderTemplate('conversation_item', conversationFields(conversation))
	bindActivate(item, () => { requestNavigate('conversation', { key: conversation.key }) })
	return item
}
