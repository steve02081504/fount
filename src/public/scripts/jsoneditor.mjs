import { createJSONEditor as base } from 'https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@2/standalone.js'

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
	return result
}

{
	const markdown_style = document.createElement('link')
	markdown_style.rel = 'stylesheet'
	markdown_style.href = 'https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@2/themes/jse-theme-dark.min.css'
	document.head.prepend(markdown_style)
}
