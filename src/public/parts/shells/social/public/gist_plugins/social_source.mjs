/**
 * gist 来源插件：social 动态导出 → gist 查看页的来源区渲染。
 */
import { formatSocialShareHttpsUrl } from '../shared/protocolUrl.mjs'
import { geti18n, setLocalizeLogic } from '/scripts/i18n/index.mjs'

/**
 * social 来源插件默认导出：供 gist 查看页按 source.type 渲染来源区（语言切换时整体重渲）。
 */
export default {
	/**
	 * @param {{ gist: object, container: HTMLElement }} param - gist 与容器。
	 * @returns {Promise<void>} 渲染完成。
	 */
	async render({ gist, container }) {
		setLocalizeLogic(container, () => {
			container.replaceChildren()
			const source = gist?.source || {}
			const ref = source.ref || {}

			const description = document.createElement('p')
			description.className = 'gist-source-description'
			description.textContent = [
				geti18n('social.gist_source_plugins.fromPost'),
				ref.author ? `${geti18n('social.gist_source_plugins.author')}：${ref.author}` : '',
				source.exportedAt
					? `${geti18n('social.gist_source_plugins.exportedAt')}：${new Date(source.exportedAt).toLocaleString()}`
					: '',
			].filter(Boolean).join(' · ')
			container.appendChild(description)

			if (ref.entityHash && ref.postId) {
				const link = document.createElement('a')
				link.className = 'btn btn-ghost btn-sm'
				link.href = formatSocialShareHttpsUrl(ref.entityHash, ref.postId)
				link.target = '_blank'
				link.rel = 'noopener'
				link.textContent = geti18n('social.gist_source_plugins.jumpToSource')
				container.appendChild(link)
			}

			const sendButton = document.createElement('button')
			sendButton.type = 'button'
			sendButton.className = 'btn btn-ghost btn-sm'
			sendButton.textContent = geti18n('social.gist_source_plugins.sendToSocial')
			sendButton.addEventListener('click', async () => {
				await navigator.clipboard.writeText(gist.markdown || '')
				const { showToastI18n } = await import('/scripts/features/toast.mjs')
				showToastI18n('success', 'social.gist_source_plugins.copied')
			})
			container.appendChild(sendButton)
		})
	},
}
