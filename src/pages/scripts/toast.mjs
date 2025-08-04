let toastContainer = null

const icons = {
	info: 'https://api.iconify.design/line-md/alert-circle.svg',
	success: 'https://api.iconify.design/line-md/confirm-circle.svg',
	warning: 'https://api.iconify.design/line-md/alert.svg',
	error: 'https://api.iconify.design/line-md/alert.svg',
}

function ensureToastContainer() {
	if (!toastContainer)
		toastContainer = document.querySelector('#toast-container')

	if (!toastContainer) {
		toastContainer = document.createElement('div')
		toastContainer.id = 'toast-container'
		toastContainer.className = 'toast toast-bottom toast-end z-[100]'
		document.body.appendChild(toastContainer)
	}
	return toastContainer
}

export function showToast(message, type = 'info', duration = 4000) {
	const container = ensureToastContainer()
	const alertId = `alert-${Date.now()}`
	const alertDiv = document.createElement('div')
	alertDiv.id = alertId
	alertDiv.className = `alert alert-${type} shadow-lg animate-fade-in-up`

	const iconUrl = icons[type] || icons.info
	const iconElement = document.createElement('img')
	iconElement.src = iconUrl
	iconElement.className = 'h-6 w-6 flex-shrink-0'

	const textElement = document.createElement('div')
	textElement.innerHTML = `<span>${message.replace(/\n/g, '<br>')}</span>`

	alertDiv.appendChild(iconElement)
	alertDiv.appendChild(textElement)

	let hideTimeout

	const startTimer = () => {
		hideTimeout = setTimeout(() => {
			alertDiv.classList.add('animate-fade-out-down')
			alertDiv.addEventListener('animationend', () => {
				alertDiv.remove()
			})
		}, duration)
	}

	const resetTimer = () => {
		clearTimeout(hideTimeout)
		startTimer()
	}

	alertDiv.addEventListener('mouseenter', () => clearTimeout(hideTimeout))
	alertDiv.addEventListener('mouseleave', resetTimer)

	container.appendChild(alertDiv)
	startTimer()
}

const style = document.createElement('style')
style.textContent = `\
@keyframes animate-fade-in-up {
	from { opacity: 0; transform: translateY(20px); }
	to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in-up {
	animation: animate-fade-in-up 0.3s ease-out forwards;
}
@keyframes animate-fade-out-down {
	from { opacity: 1; transform: translateY(0); }
	to { opacity: 0; transform: translateY(20px); }
}
.animate-fade-out-down {
	animation: animate-fade-out-down 0.3s ease-in forwards;
}
`
document.head.appendChild(style)
