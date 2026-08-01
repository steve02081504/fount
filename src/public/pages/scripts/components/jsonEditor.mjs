import { createJSONEditor as base } from 'https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@3/standalone.js'
import { jsonrepair } from 'https://esm.sh/jsonrepair'

import { geti18n, setLocalizeLogic } from '../i18n/index.mjs'
import { onThemeChange } from '../theme/index.mjs'

/**
 * 创建一个 JSON 编辑器。
 * @param {HTMLElement} jsonEditorContainer - JSON 编辑器的容器元素。
 * @param {object} options - 选项（其余字段透传给 vanilla-jsoneditor）。
 * @param {string} options.ariaLabel - 编辑器 `aria-label` 的 i18n key。
 * @param {(json: unknown) => void} [options.onSave] - Ctrl+S 保存回调（传入 `getJson()`）。
 * @returns {import('npm:vanilla-jsoneditor').JSONEditor & { getJson: () => unknown }} 编辑器实例（保留原生 `get`/`set`，另附 `getJson`）。
 */
export function createJsonEditor(jsonEditorContainer, options) {
	const { ariaLabel: ariaLabelKey, onSave, ...editorProps } = options

	// Temporary: toolbar .fa-icon presentation-role-conflict until upstream fix
	jsonEditorContainer.setAttribute('aria-ignore', 'https://github.com/josdejong/svelte-jsoneditor/issues/584')

	const result = base({
		target: jsonEditorContainer,
		props: {
			mode: 'text',
			indentation: '\t',
			...editorProps,
			ariaLabel: geti18n(ariaLabelKey),
		}
	})

	/**
	 * 取解析后的 JSON；仅有 text 时经 jsonrepair 再 parse。
	 * @returns {unknown} JSON 值
	 */
	result.getJson = () => {
		const content = result.get()
		if ('json' in content) return content.json
		return JSON.parse(jsonrepair(content.text))
	}

	setLocalizeLogic(jsonEditorContainer, () => {
		result.updateProps({ ariaLabel: geti18n(ariaLabelKey) })
	})

	if (onSave) jsonEditorContainer.addEventListener('keydown', e => {
		if (e.ctrlKey && e.key === 's') {
			e.preventDefault()
			onSave(result.getJson())
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

// --- 全局样式注入 ---

{
	const jse_style = document.createElement('style')
	jse_style.textContent = /* css */ `\
.jsoneditor-container {
	width: 100%;
	--jse-theme-color: var(--color-primary) !important;
	--jse-a-color: var(--color-primary) !important;
	--jse-menu-color: var(--color-primary-content) !important;
	--jse-theme-color-highlight: var(--color-info) !important;
}
`
	document.head.prepend(jse_style)
}

{
	const jse_style = document.createElement('link')
	jse_style.rel = 'stylesheet'
	jse_style.href = 'https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@3/themes/jse-theme-dark.css'
	jse_style.crossorigin = 'anonymous'
	document.head.prepend(jse_style)
}
