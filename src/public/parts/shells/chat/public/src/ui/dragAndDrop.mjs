/**
 * 【文件】public/src/ui/dragAndDrop.mjs
 * 【职责】为编写器区域添加拖拽与粘贴上传附件支持；消息区全屏拖放提示层。
 */
import { geti18n } from '/scripts/i18n/index.mjs'

import { handleFilesSelect, handlePaste } from '../composerAttachments.mjs'

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

/**
 * 在消息主区域启用 Discord 式全屏拖放上传提示。
 * @param {HTMLElement} dropRoot 拖放根（如 `#chat-main` / `#messages` 祖先）
 * @param {Array<object>} selectedFiles 附件队列
 * @param {HTMLElement | null} attachmentPreviewContainer 预览容器
 * @param {() => string} getChannelLabel 当前频道名
 * @returns {void}
 */
export function addMessageAreaFileDrop(dropRoot, selectedFiles, attachmentPreviewContainer, getChannelLabel) {
	if (!dropRoot || dropRoot.dataset.fileDropWired === '1') return
	dropRoot.dataset.fileDropWired = '1'

	let depth = 0
	/** @type {HTMLElement | null} */
	let overlay = null

	/**
	 * @returns {void}
	 */
	function ensureOverlay() {
		if (overlay) return
		overlay = document.createElement('div')
		overlay.className = 'chat-file-drop-overlay'
		overlay.innerHTML = '<div class="chat-file-drop-card"><span class="chat-file-drop-label"></span></div>'
		dropRoot.appendChild(overlay)
	}

	/**
	 * @param {boolean} show 是否显示
	 * @returns {void}
	 */
	function setVisible(show) {
		ensureOverlay()
		const label = overlay?.querySelector('.chat-file-drop-label')
		if (label instanceof HTMLElement) {
			const channel = getChannelLabel() || ''
			label.textContent = geti18n('chat.hub.attachment.dropToUpload', { channel })
				|| `Upload to #${channel}`
		}
		overlay?.classList.toggle('show', show)
	}

	/**
	 * @param {DragEvent} event 拖放事件
	 * @returns {boolean} 是否含文件
	 */
	function hasFiles(event) {
		return [...event.dataTransfer?.types || []].includes('Files')
	}

	dropRoot.addEventListener('dragenter', event => {
		if (!hasFiles(event)) return
		event.preventDefault()
		depth++
		setVisible(true)
	})
	dropRoot.addEventListener('dragover', event => {
		if (!hasFiles(event)) return
		event.preventDefault()
		event.dataTransfer.dropEffect = 'copy'
	})
	dropRoot.addEventListener('dragleave', () => {
		depth = Math.max(0, depth - 1)
		if (!depth) setVisible(false)
	})
	dropRoot.addEventListener('drop', event => {
		if (!hasFiles(event)) return
		event.preventDefault()
		event.stopPropagation()
		depth = 0
		setVisible(false)
		if (attachmentPreviewContainer)
			void handleFilesSelect(event, selectedFiles, attachmentPreviewContainer)
	})
}
