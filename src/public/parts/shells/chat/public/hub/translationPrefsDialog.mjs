/**
 * Chat Hub 用户级翻译偏好面板（挂入偏好壳内容区）。
 */
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { getTranslationPrefs, putTranslationPrefs } from '../src/endpoints/prefs.mjs'
import { renderTemplate } from '../src/templates.mjs'

import { closeOverlayModal } from './core/overlayModal.mjs'

/**
 * 在偏好壳的 panel / footer 中挂载翻译设置。
 * @param {HTMLElement} panel 内容区
 * @param {HTMLElement} footer 底栏
 * @returns {Promise<void>}
 */
export async function mountTranslationPrefsPanel(panel, footer) {
	let prefs = { autoTranslate: false }
	try {
		prefs = (await getTranslationPrefs()).prefs || prefs
	}
	catch (error) {
		handleError('chat.hub.operationFailed')(error)
	}
	const root = await renderTemplate('hub/prefs/translation', {
		autoTranslateChecked: prefs.autoTranslate ? 'checked' : '',
	})
	const body = root.querySelector?.('[data-translation-part="body"]') || root
	const foot = root.querySelector?.('[data-translation-part="footer"]')
	panel.replaceChildren(body)
	footer.replaceChildren(...foot ? [...foot.childNodes] : [])

	footer.querySelector('[data-action="close"]')?.addEventListener('click', () => closeOverlayModal())
	footer.querySelector('[data-action="save"]')?.addEventListener('click', async () => {
		try {
			await putTranslationPrefs({
				prefs: {
					...prefs,
					autoTranslate: panel.querySelector('#auto-translate') instanceof HTMLInputElement
						&& /** @type {HTMLInputElement} */ panel.querySelector('#auto-translate').checked,
				},
			})
			showToastI18n('success', 'chat.hub.translationPrefs.saved')
			closeOverlayModal()
		}
		catch (error) {
			handleError('chat.hub.translationPrefs.saveFailed')(error)
		}
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
