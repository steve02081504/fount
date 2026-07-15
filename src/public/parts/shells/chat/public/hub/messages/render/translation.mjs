/**
 * 【文件】public/hub/messages/render/translation.mjs
 * 【职责】消息列表自动翻译挂载。
 */
import { geti18n } from '../../../../../../scripts/i18n/index.mjs'

/**
 * 自动翻译：拉取偏好后，对需要翻译的消息 mount 译文块。
 * @param {HTMLElement} container 消息列表根
 * @returns {Promise<void>}
 */
export async function autoTranslateMessages(container) {
	if (!(container instanceof HTMLElement)) return
	try {
		const response = await fetch('/api/parts/shells:chat/translation-prefs', { credentials: 'include' })
		if (!response.ok) return
		const prefs = await response.json()
		if (!prefs?.autoTranslate) return

		const excludeLocales = new Set(Array.isArray(prefs.excludeLocales) ? prefs.excludeLocales : [])
		const { requestTranslation, resolveTargetLang, mountTranslationBlock } = await import('/scripts/features/translate.mjs')
		const targetLang = resolveTargetLang()

		const rows = container.querySelectorAll('.chat[data-message-id][data-message-locale]')
		for (const row of rows) {
			if (!(row instanceof HTMLElement)) continue
			const locale = row.getAttribute('data-message-locale') || ''
			if (!locale || excludeLocales.has(locale)) continue
			if (locale.toLowerCase().startsWith(targetLang.toLowerCase().split('-')[0])) continue
			const bubble = row.querySelector('.hub-message-content')
			if (!(bubble instanceof HTMLElement)) continue
			if (bubble.querySelector('.translation-block')) continue

			const text = bubble.textContent?.trim() || ''
			if (!text) continue
			try {
				const translated = await requestTranslation('/api/parts/shells:chat/translate', text, targetLang)
				mountTranslationBlock(bubble, {
					originalText: text,
					translatedText: translated,
					showOriginalLabel: geti18n('chat.hub.translateShowOriginal') || 'Original',
					showTranslationLabel: geti18n('chat.hub.translateShowTranslation') || 'Translation',
					translationLabel: geti18n('chat.hub.translateLabel') || '',
				})
			}
			catch { /* 翻译失败静默跳过 */ }
		}
	}
	catch { /* 偏好拉取失败或端点未就绪 */ }
}
