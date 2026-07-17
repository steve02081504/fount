/**
 * Chat Hub 用户级翻译偏好面板（挂入偏好壳内容区）。
 */
import { renderTemplate, usingTemplates } from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { closeOverlayModal } from './core/overlayModal.mjs'

/**
 * 在偏好壳的 panel / footer 中挂载翻译设置。
 * @param {HTMLElement} panel 内容区
 * @param {HTMLElement} footer 底栏
 * @returns {Promise<void>}
 */
export async function mountTranslationPrefsPanel(panel, footer) {
	usingTemplates('/parts/shells:chat/src/templates')
	const response = await fetch('/api/parts/shells:chat/translation-prefs', { credentials: 'include' })
	const data = response.ok ? await response.json() : { prefs: { autoTranslate: false } }
	const prefs = data.prefs || { autoTranslate: false }
	const root = await renderTemplate('hub/prefs/translation', {
		autoTranslateChecked: prefs.autoTranslate ? 'checked' : '',
	})
	const body = root.querySelector?.('[data-translation-part="body"]') || root
	const foot = root.querySelector?.('[data-translation-part="footer"]')
	panel.replaceChildren(body)
	footer.replaceChildren(...(foot ? [...foot.childNodes] : []))

	footer.querySelector('[data-action="close"]')?.addEventListener('click', () => closeOverlayModal())
	footer.querySelector('[data-action="save"]')?.addEventListener('click', () => {
		const checked = panel.querySelector('#hub-auto-translate') instanceof HTMLInputElement
			&& /** @type {HTMLInputElement} */ (panel.querySelector('#hub-auto-translate')).checked
		void fetch('/api/parts/shells:chat/translation-prefs', {
			method: 'PUT',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ prefs: { ...prefs, autoTranslate: checked } }),
		}).then(res => {
			if (!res.ok) throw new Error(String(res.status))
			showToastI18n('success', 'chat.hub.translationPrefs.saved')
			closeOverlayModal()
		}).catch(error => {
			showToastI18n('error', 'chat.hub.translationPrefs.saveFailed', { error: error?.message || String(error) })
		})
	})
}

/**
 * 打开翻译偏好（走统一偏好壳）。
 * @returns {Promise<void>}
 */
export async function openTranslationPrefsDialog() {
	const { openHubPrefsModal } = await import('./hubPrefs.mjs')
	await openHubPrefsModal({ section: 'translation' })
}
