/** @type {import('npm:@sentry/browser')} */
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { geti18n, setLocalizeLogic } from './i18n.mjs'

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

function base_showToast(type, message, duration = 4000) {
	if (!(message instanceof HTMLElement) && !(Object(message) instanceof String)) {
		Sentry.captureException(new Error(`showToast() called with non-string/non-HTMLElement message: ${message}`))
		message = String(message)
	}
	const container = ensureToastContainer()
	const alertId = `alert-${Date.now()}`
	const alertDiv = document.createElement('div')
	if (type == 'custom') {
		if (Object(message) instanceof HTMLElement)
			alertDiv.appendChild(message)
		else
			alertDiv.innerHTML = message
		alertDiv.id = alertId
	}
	else {
		alertDiv.id = alertId
		alertDiv.className = `alert alert-${type} shadow-lg`

		const iconUrl = icons[type] || icons.info
		const iconElement = document.createElement('img')
		iconElement.src = iconUrl
		iconElement.className = 'h-6 w-6 flex-shrink-0'

		const textElement = document.createElement('div')
		if (Object(message) instanceof HTMLElement)
			alertDiv.appendChild(message)
		else
			alertDiv.innerHTML = message.replace(/\n/g, '<br>')

		alertDiv.appendChild(iconElement)
		alertDiv.appendChild(textElement)
	}
	alertDiv.className += ' animate-fade-in-up'

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
	return alertDiv
}
export function showToast(type = 'info', message, duration = 4000) {
	base_showToast(type, message, duration)
}
export function showToastI18n(type = 'info', key, params = {}, duration = 4000) {
	const div = base_showToast(type, '', duration)
	setLocalizeLogic(div, () => {
		div.querySelector('div').innerHTML = geti18n(key, params).replace(/\n/g, '<br>')
	})
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
