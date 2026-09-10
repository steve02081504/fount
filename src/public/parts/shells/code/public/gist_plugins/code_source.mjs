/**
 * code shell 的 gist 来源插件：渲染 gist 来源描述（来自编码会话 · 会话 id · 导出时间）。
 */
import { geti18n, setLocalizeLogic } from '/scripts/i18n/index.mjs'

/**
 * code 来源插件默认导出：供 gist 查看页按 source.type 渲染来源区。
 */
export default {
	/**
	 * 渲染 code 来源区（语言切换时整体重渲）。
	 * @param {{ gist: object, container: HTMLElement }} param - gist 与容器。
	 * @returns {Promise<void>} 渲染完成。
	 */
	async render({ gist, container }) {
		setLocalizeLogic(container, () => {
			container.replaceChildren()
			const ref = gist.source?.ref || {}
			const block = document.createElement('div')
			block.className = 'gist-source-code'
			const title = document.createElement('div')
			title.className = 'font-semibold'
			title.textContent = geti18n('code.gist_source_plugins.fromSession')
			block.appendChild(title)
			const list = document.createElement('dl')
			list.className = 'grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-sm opacity-80'
			const sessionId = document.createElement('dt')
			sessionId.textContent = geti18n('code.gist_source_plugins.sessionId')
			const sessionIdValue = document.createElement('dd')
			sessionIdValue.textContent = ref.sessionId ?? ''
			const exportedAt = document.createElement('dt')
			exportedAt.textContent = geti18n('code.gist_source_plugins.exportedAt')
			const exportedAtValue = document.createElement('dd')
			const exported = ref.exportedAt ?? gist.source?.exportedAt
			exportedAtValue.textContent = exported ? new Date(exported).toLocaleString() : ''
			list.append(sessionId, sessionIdValue, exportedAt, exportedAtValue)
			block.append(list)
			const sendButton = document.createElement('button')
			sendButton.type = 'button'
			sendButton.className = 'btn btn-ghost btn-sm'
			sendButton.textContent = geti18n('code.gist_source_plugins.sendToWorkspace')
			sendButton.addEventListener('click', async () => {
				// code 页面在场时经 fount.user.send 直接发到当前会话；否则复制正文降级
				if (globalThis.fount?.user?.send) {
					await globalThis.fount.user.send(gist.markdown || '')
					const { showToastI18n } = await import('/scripts/features/toast.mjs')
					showToastI18n('success', 'code.gist_source_plugins.sent')
				}
				else {
					await navigator.clipboard.writeText(gist.markdown || '')
					const { showToastI18n } = await import('/scripts/features/toast.mjs')
					showToastI18n('success', 'code.gist_source_plugins.copied')
				}
			})
			block.append(sendButton)
			container.appendChild(block)
		})
	},
}
