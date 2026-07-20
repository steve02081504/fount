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
 * @param {{
 *   originalText: string
 *   translatedText: string
 *   showOriginalLabel: string
 *   showTranslationLabel: string
 *   translationLabel?: string
 * }} options 文案与内容
 * @returns {HTMLElement} 译文块根元素
 */
export function mountTranslationBlock(container, {
	originalText,
	translatedText,
	showOriginalLabel,
	showTranslationLabel,
	translationLabel = '',
}) {
	if (!(container instanceof HTMLElement)) throw new Error('mountTranslationBlock: invalid container')

	let block = container.querySelector(':scope > .translation-block')
	if (!block) {
		block = document.createElement('div')
		block.className = 'translation-block'
		const content = document.createElement('div')
		content.className = 'translation-content'
		const toggle = document.createElement('button')
		toggle.type = 'button'
		toggle.className = 'translation-toggle btn btn-ghost btn-xs'
		block.appendChild(content)
		block.appendChild(toggle)
		container.appendChild(block)

		toggle.addEventListener('click', () => {
			const showingTranslated = block.dataset.showingTranslated !== '0'
			block.dataset.showingTranslated = showingTranslated ? '0' : '1'
			paintTranslationBlock(block)
		})
	}

	block.dataset.originalText = originalText
	block.dataset.translatedText = translatedText
	block.dataset.showOriginalLabel = showOriginalLabel
	block.dataset.showTranslationLabel = showTranslationLabel
	if (translationLabel) block.dataset.translationLabel = translationLabel
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
	const content = block.querySelector('.translation-content')
	const toggle = block.querySelector('.translation-toggle')
	if (!(content instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement)) return

	const text = showingTranslated ? block.dataset.translatedText : block.dataset.originalText
	const prefix = showingTranslated && block.dataset.translationLabel
		? `${block.dataset.translationLabel} `
		: ''
	content.textContent = `${prefix}${text ?? ''}`
	toggle.textContent = showingTranslated
		? block.dataset.showOriginalLabel
		: block.dataset.showTranslationLabel
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
