import { createJSONEditor as base } from 'https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@2/standalone.js'

import { onThemeChange } from './theme.mjs'

/**
 * @description 创建一个 JSON 编辑器。
 * @param {HTMLElement} jsonEditorContainer - JSON 编辑器的容器元素。
 * @param {object} options - 选项。
 * @returns {import('vanilla-jsoneditor').JSONEditor} JSON 编辑器实例。
 */
export function createJsonEditor(jsonEditorContainer, options) {
	const result = base({
		target: jsonEditorContainer,
		props: {
			mode: 'code',
			indentation: '\t',
			...options
		}
	})
	// ctrl+s 保存
	document.addEventListener('keydown', e => {
		if (e.ctrlKey && e.key === 's') {
			options.onSave(result.get().json || JSON.parse(result.get().text))
			e.preventDefault()
		}
	})
	onThemeChange(
		(theme, isDark) => {
			if (isDark) jsonEditorContainer.classList.add('jse-theme-dark')
			else jsonEditorContainer.classList.remove('jse-theme-dark')
		}
	)
	return result
}

{
	const jse_style = document.createElement('link')
	jse_style.rel = 'stylesheet'
	jse_style.href = 'https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@2/themes/jse-theme-dark.min.css'
	jse_style.crossorigin = 'anonymous'
	document.head.prepend(jse_style)
}
