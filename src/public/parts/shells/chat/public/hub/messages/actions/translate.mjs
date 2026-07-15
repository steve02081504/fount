/**
 * 【文件】public/hub/messages/actions/translate.mjs
 * 【职责】手动翻译消息并挂载译文块。
 */
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { geti18n } from '../../../../../../scripts/i18n/index.mjs'
import { getMessageText } from '../render/text.mjs'

/**
 * @param {HTMLElement} button 被点击按钮
 * @param {HTMLElement | null} row 消息行
 * @param {object} channelMessage 消息
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleTranslate(button, row, channelMessage) {
	const text = getMessageText(channelMessage)
	if (!text) return true
	button.disabled = true
	try {
		const { mountTranslationBlock, requestTranslation, resolveTargetLang } = await import('/scripts/features/translate.mjs')
		const targetLang = resolveTargetLang()
		const translated = await requestTranslation('/api/parts/shells:chat/translate', text, targetLang)
		const bubble = row?.querySelector('.hub-message-content')
		if (bubble instanceof HTMLElement) 
			mountTranslationBlock(bubble, {
				originalText: text,
				translatedText: translated,
				showOriginalLabel: geti18n('chat.hub.translateShowOriginal') || 'Original',
				showTranslationLabel: geti18n('chat.hub.translateShowTranslation') || 'Translation',
				translationLabel: geti18n('chat.hub.translateLabel') || '',
			})
		
	}
	catch (error) {
		showToastI18n('error', 'chat.hub.translateFailed', { error: error?.message || String(error) })
	}
	finally { button.disabled = false }
	return true
}
