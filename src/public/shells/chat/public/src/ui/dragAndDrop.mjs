import { handleFilesSelect, handlePaste } from '../fileHandling.mjs'

/**
 * 添加拖拽上传支持函数
 * @param {HTMLElement} element - 监听拖拽事件的 DOM 元素。
 * @param {Array<File>} selectedFiles - 存储选定文件的数组。
 * @param {HTMLElement} attachmentPreviewContainer - 附件预览容器的 DOM 元素。
 */
export function addDragAndDropSupport(element, selectedFiles, attachmentPreviewContainer) {
	element.addEventListener('dragover', event => {
		event.preventDefault()
		event.stopPropagation()
		element.classList.add('dragover')
	})

	element.addEventListener('dragleave', () => {
		element.classList.remove('dragover')
	})

	element.addEventListener('drop', event => {
		event.preventDefault()
		event.stopPropagation()
		element.classList.remove('dragover')
		handleFilesSelect(event, selectedFiles, attachmentPreviewContainer)
	})

	element.addEventListener('paste', event => {
		handlePaste(event, selectedFiles, attachmentPreviewContainer)
	})
}
