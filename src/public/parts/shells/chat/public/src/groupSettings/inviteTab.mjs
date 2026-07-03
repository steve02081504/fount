import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { createGroupInvite } from '../api/groupApi.mjs'

/** @param {import('./state.mjs').GroupSettingsContext} ctx @returns {void} */
export function wireInvitePanel(ctx) {
	document.getElementById('group-settings-mint-invite-button')?.addEventListener('click', async () => {
		if (!ctx.groupId || !ctx.settingsCaps?.canInviteMembers) return
		const button = document.getElementById('group-settings-mint-invite-button')
		if (!(button instanceof HTMLButtonElement)) return
		button.disabled = true
		try {
			const { code, expiresAt, clipboardText } = await createGroupInvite(ctx.groupId)
			ctx.lastInviteClipboardText = clipboardText || ''
			document.getElementById('group-settings-invite-group-id').textContent = ctx.groupId
			document.getElementById('invite-code').textContent = code
			const expEl = document.getElementById('invite-exp')
			if (expEl) {
				expEl.dataset.date = new Date(expiresAt).toLocaleString()
				expEl.dataset.i18n = 'chat.group.settingsPage.inviteExpires'
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
			if (!ctx.lastInviteClipboardText)
				throw new Error('no invite clipboard text')
			await navigator.clipboard.writeText(ctx.lastInviteClipboardText)
			showToastI18n('success', 'chat.group.settingsPage.inviteCopied')
		}
		catch {
			showToastI18n('error', 'chat.group.settingsPage.inviteCopyFailed')
		}
	})
}
