import { primaryLocale } from '../i18n/index.mjs'

/**
 * 解析翻译目标语言：用户首选主区域。
 * @returns {string} BCP 47 语言标签
 */
export function resolveTargetLang() {
	return primaryLocale()
}

/**
 * 在容器内挂载或更新译文块，带原文/译文切换（不重复 append）。
 * @param {HTMLElement} container 挂载容器
 * @param {{ originalText: string, translatedText: string }} options 原文与译文
 * @returns {HTMLElement} 译文块根元素
 */
export function mountTranslationBlock(container, { originalText, translatedText }) {
	if (!(container instanceof HTMLElement)) throw new Error('mountTranslationBlock: invalid container')

	let block = container.querySelector(':scope > .translation-block')
	if (!block) {
		block = document.createElement('div')
		block.className = 'translation-block'
		block.innerHTML = `\
<div class="translation-content">
	<strong class="translation-label" data-i18n="util.common.translate.label"></strong>
	<span class="translation-text" user-content></span>
</div>
<button type="button" class="translation-toggle btn btn-ghost btn-xs" data-i18n="util.common.translate.showOriginal"></button>
`
		container.appendChild(block)
		block.querySelector('.translation-toggle').addEventListener('click', () => {
			const showingTranslated = block.dataset.showingTranslated !== '0'
			block.dataset.showingTranslated = showingTranslated ? '0' : '1'
			paintTranslationBlock(block)
		})
	}

	block.dataset.originalText = originalText
	block.dataset.translatedText = translatedText
	block.dataset.showingTranslated ??= '1'
	paintTranslationBlock(block)
	return block
}

/**
 * @param {HTMLElement} block 译文块
 * @returns {void}
 */
function paintTranslationBlock(block) {
	const showingTranslated = block.dataset.showingTranslated !== '0'
	const label = block.querySelector('.translation-label')
	const text = block.querySelector('.translation-text')
	const toggle = block.querySelector('.translation-toggle')
	if (!(text instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement)) return

	if (label instanceof HTMLElement)
		label.hidden = !showingTranslated
	text.textContent = (showingTranslated ? block.dataset.translatedText : block.dataset.originalText) ?? ''
	toggle.dataset.i18n = showingTranslated
		? 'util.common.translate.showOriginal'
		: 'util.common.translate.showTranslation'
}

/**
 * POST 翻译请求并返回译文。
 * @param {string} apiPath 完整 API 路径
 * @param {string} text 原文
 * @param {string} targetLang 目标语言
 * @returns {Promise<string>} 译文
 */
export async function requestTranslation(apiPath, text, targetLang) {
	const response = await fetch(apiPath, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text, targetLang }),
	})
	if (!response.ok) throw new Error(await response.text())
	const data = await response.json()
	return String(data.translated ?? text)
}
