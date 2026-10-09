import { getFederationSettings } from '/scripts/endpoints/p2p/federation.mjs'
import { setElementI18n } from '/scripts/i18n/index.mjs'
import { formatChatDmShareUrl } from '/parts/shells:chat/shared/runUri.mjs'

/** @returns {void} 首页常驻入网邀请入口，剪贴板不可用时展示可手动复制的链接。 */
export function wireInviteFriends() {
	const button = document.getElementById('home-invite-copy')
	const link = document.getElementById('home-invite-link')
	const field = document.getElementById('home-invite-field')
	const status = document.getElementById('home-invite-status')
	button.addEventListener('click', async () => {
		button.disabled = true
		button.setAttribute('aria-busy', 'true')
		setElementI18n(status, 'home.inviteFriends.preparing')
		try {
			if (!link.value) {
				const { entityHash } = await getFederationSettings()
				if (!entityHash) throw new Error('Invitation identity unavailable')
				link.value = formatChatDmShareUrl(entityHash)
			}
			field.hidden = false
			try {
				await navigator.clipboard.writeText(link.value)
				setElementI18n(status, 'home.inviteFriends.copied')
			}
			catch {
				link.focus()
				link.select()
				setElementI18n(status, 'home.inviteFriends.manualCopy')
			}
		}
		catch {
			setElementI18n(status, 'home.inviteFriends.failed')
		}
		finally {
			button.disabled = false
			button.removeAttribute('aria-busy')
		}
	})
	link.addEventListener('focus', () => link.select())
	// 模板里默认 disabled：只有接线成功（脚本已加载）才允许点击。
	button.disabled = false
}
