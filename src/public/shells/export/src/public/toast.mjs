// toast.js
const toastContainer = document.getElementById('toastMessage')
let hideTimeout = null

const icons = {
	'alert-error': 'https://api.iconify.design/line-md/alert.svg',
	'alert-success': 'https://api.iconify.design/line-md/confirm-circle.svg',
	'alert-info': 'https://api.iconify.design/line-md/alert-circle.svg',
}

/**
 * 显示信息
 * @param {string} message 信息
 * @param {string} type 类型 (error, success, info)
 */
export function showMessage(message, type = 'info') {
	const alertClass = `alert-${type}`
	const iconUrl = icons[alertClass] || icons['alert-info']

	const toastElement = document.createElement('div')
	toastElement.className = `alert ${alertClass} flex items-center shadow-lg animate-fade-in-up`

	const iconElement = document.createElement('img')
	iconElement.src = iconUrl
	iconElement.className = 'h-6 w-6 flex-shrink-0'
	toastElement.appendChild(iconElement)

	const textElement = document.createElement('span')
	textElement.textContent = message
	toastElement.appendChild(textElement)

	toastContainer.appendChild(toastElement)

	// Automatically remove the toast after some time
	hideTimeout = setTimeout(() => {
		toastElement.classList.add('animate-fade-out-down')
		toastElement.addEventListener('animationend', () => {
			toastElement.remove()
		})
	}, 5000)
}

// Add some basic animations to the base css if they don't exist
const style = document.createElement('style')
style.textContent = `
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
