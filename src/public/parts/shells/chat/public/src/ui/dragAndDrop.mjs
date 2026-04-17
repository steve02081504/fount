/**
 * 为输入框元素添加拖拽文件上传和剪贴板粘贴支持。
 * @param {HTMLElement} element - 目标输入元素
 * @param {(files: File[]) => void} onFiles - 收到文件时的回调
 * @param {{ signal?: AbortSignal }} [options] - 可选；传入 `signal` 以便与外部 AbortController 同步移除监听
 */
export function addDragAndDropSupport(element, onFiles, options = {}) {
	const listenerOpts = options.signal ? { signal: options.signal } : {}
	element.addEventListener('dragover', event => {
		event.preventDefault()
		event.stopPropagation()
		element.classList.add('dragover')
	}, listenerOpts)
	element.addEventListener('dragleave', () => element.classList.remove('dragover'), listenerOpts)
	element.addEventListener('drop', event => {
		event.preventDefault()
		event.stopPropagation()
		element.classList.remove('dragover')
		const files = [...event.dataTransfer?.files || []]
		if (files.length) onFiles(files)
	}, listenerOpts)
	element.addEventListener('paste', event => {
		const files = [...event.clipboardData?.items || []]
			.filter(item => item.kind === 'file')
			.map(item => item.getAsFile())
			.filter(Boolean)
		if (files.length) {
			event.preventDefault()
			onFiles(files)
		}
	}, listenerOpts)
}
