/**
 * 【文件】public/hub/messages/messagesPlaceholder.mjs
 * 【职责】在消息主区挂载空态 / 占位模板，同时销毁当前频道的虚拟列表管道。
 * 【原理】管道存活时直接 mountTemplate / innerHTML 会替换 #messages 的 DOM 子树，但管道仍持有旧容器引用，
 *   后续 append/refresh 会渲染进分离或混合的 DOM。本模块统一先 destroyChannelVirtualList() 再挂载，
 *   是「管道可能存活时替换 #messages 内容」的唯一受认可入口。
 */
import { mountTemplate } from '../../src/templates.mjs'

import { destroyChannelVirtualList } from './messageVirtualList.mjs'

/**
 * 销毁当前频道虚拟列表后在消息容器挂载模板。
 * @param {HTMLElement | null} container 消息容器（通常为 `#messages`）
 * @param {string} templateName 模板名
 * @param {object} [data] 模板数据
 * @returns {Promise<void>}
 */
export async function mountMessagesPlaceholder(container, templateName, data) {
	destroyChannelVirtualList()
	if (!container) return
	await mountTemplate(container, templateName, data)
}
