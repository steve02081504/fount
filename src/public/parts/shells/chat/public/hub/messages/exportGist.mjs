/**
 * 【文件】public/hub/messages/exportGist.mjs
 * 【职责】把消息导出为 gist 并跳转查看页（clipboard / contextMenu 共用同一实现）。
 * 【原理】从消息行提取 markdown，标题取首行截断 40 字符，附带 chat 来源元数据后 createGist，
 *   成功后跳转 gist 查看页；失败仅 console.error，不让调用方产生未处理 rejection。
 */
import { createGist } from '/parts/shells:gist/src/endpoints.mjs'

import { getMessageText } from './render/text.mjs'

/**
 * 把消息导出为 gist 并跳转查看页。
 * @param {object} message 消息行
 * @param {HTMLElement | null} row 消息行
 * @param {object} context 操作上下文
 * @param {string} [context.groupId] 群 ID
 * @param {string} [context.channelId] 频道 ID
 * @param {string} eventId 事件 id
 * @returns {Promise<void>} 导出完成
 */
export async function exportMessageToGist(message, row, context, eventId) {
	const markdown = getMessageText(message) || row?.querySelector('.message-content')?.textContent?.trim() || ''
	const author = message.charId ?? message.authorPubKeyHash ?? message.sender ?? ''
	try {
		const gist = await createGist({
			markdown,
			title: markdown.split('\n').find(Boolean)?.trim().slice(0, 40) || 'gist',
			securityLevel: 'secure',
			source: {
				type: 'chat',
				ref: {
					groupId: context.groupId,
					channelId: context.channelId,
					eventId,
					author,
				},
				exportedAt: Date.now(),
			},
		})
		location.href = '/parts/shells:gist/view?id=' + encodeURIComponent(gist.id)
	}
	catch (error) {
		console.error(error)
	}
}
