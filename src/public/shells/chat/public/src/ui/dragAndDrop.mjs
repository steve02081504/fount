import { handleFilesSelect, handlePaste } from '../fileHandling.mjs'

// 添加拖拽上传支持函数
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
