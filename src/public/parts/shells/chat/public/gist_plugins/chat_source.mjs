/**
 * gist 来源插件：把 chat 导出的 gist 关联回原群 / 频道 / 消息深链。
 */
import { geti18n, setLocalizeLogic } from '/scripts/i18n/index.mjs'
import { formatMessageRunUri, wrapProtocolHttpsUrl } from '../shared/runUri.mjs'

/**
 * chat 来源插件默认导出：供 gist 查看页按 source.type 渲染来源区。
 */
export default {
	/**
	 * 渲染 gist 来源区（语言切换时整体重渲）。
	 * @param {{ gist: object, container: HTMLElement }} param - gist 与容器。
	 * @returns {Promise<void>} 渲染完成。
	 */
	async render({ gist, container }) {
		setLocalizeLogic(container, () => {
			container.replaceChildren()
			const ref = gist?.source?.ref || {}
			const exportedAt = gist?.source?.exportedAt || ''
			const wrap = document.createElement('div')
			wrap.className = 'gist-source-chat'
			const parts = []
			if (ref.groupId) parts.push(geti18n('chat.gist_source_plugins.fromGroup'))
			if (ref.channelId) parts.push(geti18n('chat.gist_source_plugins.fromChannel'))
			if (ref.author) parts.push(`${geti18n('chat.gist_source_plugins.author')}：${ref.author}`)
			if (exportedAt) {
				const date = new Date(exportedAt)
				parts.push(`${geti18n('chat.gist_source_plugins.exportedAt')}：${Number.isNaN(date.getTime()) ? exportedAt : date.toLocaleString()}`)
			}
			const description = document.createElement('p')
			description.textContent = parts.join(' · ')
			wrap.appendChild(description)
			if (ref.groupId && ref.channelId && ref.eventId) {
				const href = wrapProtocolHttpsUrl(formatMessageRunUri(ref.groupId, ref.channelId, ref.eventId))
				const link = document.createElement('a')
				link.href = href
				link.target = '_blank'
				link.rel = 'noopener'
				link.textContent = geti18n('chat.gist_source_plugins.jumpToSource')
				wrap.appendChild(link)
			}
			const sendButton = document.createElement('button')
			sendButton.type = 'button'
			sendButton.textContent = geti18n('chat.gist_source_plugins.sendToChat')
			sendButton.className = 'btn btn-ghost btn-sm'
			sendButton.addEventListener('click', async () => {
				// gist 查看页无 chat 发送上下文，复制正文供用户在聊天中粘贴
				await navigator.clipboard.writeText(gist.markdown || '')
				const { showToastI18n } = await import('/scripts/features/toast.mjs')
				showToastI18n('success', 'chat.gist_source_plugins.copied')
			})
			wrap.appendChild(sendButton)
			container.appendChild(wrap)
		})
	},
}
