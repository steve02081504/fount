export function openModal(base64Data) {
	const modal = document.createElement('div')
	modal.innerHTML = `<img src="${base64Data}" class="modal-img">`
	modal.classList.add('modal', 'modal-open')
	modal.addEventListener('click', () => {
		modal.remove()
	})

	document.body.appendChild(modal)
}
