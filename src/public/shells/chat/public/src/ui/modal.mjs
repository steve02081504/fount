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
