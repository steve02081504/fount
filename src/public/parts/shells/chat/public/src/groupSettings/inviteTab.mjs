import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { createGroupInvite } from '../api/groupCore.mjs'
/** @param {import('./state.mjs').GroupSettingsContext} context @returns {void} */
export function wireInvitePanel(context) {
	document.getElementById('group-settings-mint-invite-button')?.addEventListener('click', async () => {
		if (!context.groupId || !context.settingsCaps?.canInviteMembers) return
		const button = document.getElementById('group-settings-mint-invite-button')
		if (!(button instanceof HTMLButtonElement)) return
		button.disabled = true
		try {
			const { code, expiresAt, clipboardText } = await createGroupInvite(context.groupId)
			context.lastInviteClipboardText = clipboardText || ''
			document.getElementById('group-settings-invite-group-id').textContent = context.groupId
			document.getElementById('invite-code').textContent = code
			const expElement = document.getElementById('invite-exp')
			if (expElement) {
				expElement.dataset.date = new Date(expiresAt).toLocaleString()
				expElement.dataset.i18n = 'chat.group.settingsPage.inviteExpires'
			}
			document.getElementById('invite-result')?.classList.remove('hidden')
		}
		catch (error) {
			showToastI18n('error', 'chat.group.settingsPage.saveFailed', { error: error.message })
		}
		finally {
			button.disabled = false
		}
	})
	document.getElementById('group-settings-copy-invite-button')?.addEventListener('click', async () => {
		try {
			if (!context.lastInviteClipboardText)
				throw new Error('no invite clipboard text')
			await navigator.clipboard.writeText(context.lastInviteClipboardText)
			showToastI18n('success', 'chat.group.settingsPage.inviteCopied')
		}
		catch {
			showToastI18n('error', 'chat.group.settingsPage.inviteCopyFailed')
		}
	})
}
