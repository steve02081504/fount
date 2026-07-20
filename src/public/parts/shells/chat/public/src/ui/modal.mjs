/**
 * 【文件】public/src/ui/modal.mjs
 * 【职责】轻量全屏模态：展示图片/视频等大内容预览。
 * 【原理】openModal 动态创建 .modal.modal-open，点击遮罩 closeModal 移除。
 * 【数据结构】contentSrc URL、contentType('image'|'video'|...)。
 * 【关联】composerAttachments 附件预览。
 */
/**
 * 打开模态框。
 * @param {string} contentSrc 模态框内容的来源 URL
 * @param {string} contentType 模态框内容的类型（例如 `image`、`video`）
 */
export function openModal(contentSrc, contentType) {
	const modal = document.createElement('div')
	modal.classList.add('modal', 'modal-open')

	let modalContentElement

	if (contentType === 'image') {
		modalContentElement = document.createElement('img')
		modalContentElement.src = contentSrc
		modalContentElement.classList.add('modal-img')
	}
	else if (contentType === 'video') {
		modalContentElement = document.createElement('video')
		modalContentElement.src = contentSrc
		modalContentElement.controls = true
		modalContentElement.autoplay = true
		modalContentElement.classList.add('modal-video')
	}
	else {
		console.error('Unsupported content type for modal:', contentType)
		return // Don't open modal for unsupported types
	}

	modalContentElement.style.maxWidth = '90vw'
	modalContentElement.style.maxHeight = '90vh'
	modal.appendChild(modalContentElement)

	modal.addEventListener('click', e => {
		// Close only if the modal background (not the content itself) is clicked
		if (e.target === modal) {
			// If it's a video, pause it before removing the modal
			if (contentType === 'video' && modalContentElement)
				modalContentElement.pause()

			modal.remove()
		}
	})

	document.body.appendChild(modal)
}
