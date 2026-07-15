/**
 * Chat Hub 用户级翻译偏好：挂在通知偏好对话框旁，通过 server bar 菜单入口触发。
 */
import { openDialogFromTemplate } from '../../../../scripts/features/dialog.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'

/**
 * 打开翻译偏好对话框。
 * @returns {Promise<void>}
 */
export async function openTranslationPrefsDialog() {
	const response = await fetch('/api/parts/shells:chat/translation-prefs', { credentials: 'include' })
	const data = response.ok ? await response.json() : { prefs: { autoTranslate: false } }
	const prefs = data.prefs || { autoTranslate: false }
	await openDialogFromTemplate('hub/modals/translation_prefs', {
		autoTranslateChecked: prefs.autoTranslate ? 'checked' : '',
	}, {
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {void}
		 */
		onReady(dialog) {
			dialog.querySelector('[data-action="save"]')?.addEventListener('click', () => {
				const checked = dialog.querySelector('#hub-auto-translate') instanceof HTMLInputElement
					&& /** @type {HTMLInputElement} */ dialog.querySelector('#hub-auto-translate').checked
				void fetch('/api/parts/shells:chat/translation-prefs', {
					method: 'PUT',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ prefs: { ...prefs, autoTranslate: checked } }),
				}).then(res => {
					if (!res.ok) throw new Error(String(res.status))
					showToastI18n('success', 'chat.hub.translationPrefs.saved')
					dialog.close()
				}).catch(error => {
					showToastI18n('error', 'chat.hub.translationPrefs.saveFailed', { error: error?.message || String(error) })
				})
			})
		},
	})
}
