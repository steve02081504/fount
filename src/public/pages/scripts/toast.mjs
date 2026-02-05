/** @type {import('npm:@sentry/browser')} */
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { geti18n, setLocalizeLogic } from './i18n.mjs'

/** 显式设置的 toast 容器；为 null 时使用默认的 #toast-container。 */
let toastContainer = null

/** 未传 duration 时使用的默认持续时间（毫秒）；0 表示不自动消失。页面可设为 0 以得到 showMessage 式常驻提示。 */
let defaultToastDuration = 4000

const icons = {
	info: 'https://api.iconify.design/line-md/alert-circle.svg',
	success: 'https://api.iconify.design/line-md/confirm-circle.svg',
	warning: 'https://api.iconify.design/line-md/alert.svg',
	error: 'https://api.iconify.design/line-md/alert.svg',
}

/**
 * 确保 toast 容器存在。
 * 若已通过 setToastContainer 设置则返回该容器，否则使用或创建默认的 #toast-container。
 * @returns {HTMLElement} - toast 容器。
 */
function ensureToastContainer() {
	return (toastContainer ??= document.getElementById('toast-container')) || document.body.appendChild(toastContainer = Object.assign(document.createElement('div'), {
		id: 'toast-container',
		className: 'toast toast-bottom toast-end z-[100]'
	})) && toastContainer
}

/**
 * 设置 toast 使用的容器；toast 将追加到此元素内。
 * 传入 null 或省略则恢复使用默认容器。
 * @param {HTMLElement | null} [container] - 作为容器的元素。
 */
export function setToastContainer(container) {
	toastContainer = container ?? null
}

/**
 * 返回当前用于显示 toast 的容器（即 ensureToastContainer() 的结果）。
 * 可用于清空当前页的 toast 区域，例如 getToastContainer().innerHTML = ''。
 * @returns {HTMLElement} - 当前 toast 容器。
 */
export function getToastContainer() {
	return ensureToastContainer()
}

/**
 * 设置本页 toast 的默认持续时间；未传 duration 的 showToast/showToastI18n 将使用此值。
 * 传 0 可让该页所有 toast 不自动消失（常驻直到清空容器），等同于 showMessage 行为。
 * @param {number} ms - 默认持续时间（毫秒），0 表示不自动消失。
 */
export function setDefaultToastDuration(ms) {
	defaultToastDuration = ms
}

/**
 * 显示一个基本的 toast。
 * @param {string} type - toast 类型。
 * @param {string|HTMLElement} message - toast 消息。
 * @param {number} [duration] - toast 持续时间。
 * @returns {HTMLElement} - toast 元素。
 */
function base_showToast(type, message, duration = defaultToastDuration) {
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

	/**
	 * 启动计时器。
	 * @returns {void}
	 */
	const startTimer = () => {
		if (duration <= 0) return
		hideTimeout = setTimeout(() => {
			alertDiv.classList.add('animate-fade-out-down')
			alertDiv.addEventListener('animationend', () => {
				alertDiv.remove()
			})
		}, duration)
	}

	/**
	 * 重置计时器。
	 * @returns {void}
	 */
	const resetTimer = () => {
		if (duration <= 0) return
		clearTimeout(hideTimeout)
		startTimer()
	}

	alertDiv.addEventListener('mouseenter', () => clearTimeout(hideTimeout))
	alertDiv.addEventListener('mouseleave', resetTimer)

	container.appendChild(alertDiv)
	startTimer()
	return alertDiv
}

/**
 * 显示一个 toast。
 * @param {string} [type='info'] - toast 类型。
 * @param {string|HTMLElement} message - toast 消息。
 * @param {number} [duration] - 持续时间（毫秒）；不传则用 setDefaultToastDuration 设置的值，0 表示不自动消失。
 * @returns {void}
 */
export function showToast(type = 'info', message, duration) {
	base_showToast(type, message, duration)
}
/**
 * 显示一个 i18n toast。
 * @param {string} [type='info'] - toast 类型。
 * @param {string} key - i18n 键。
 * @param {object} [params={}] - i18n 参数。
 * @param {number} [duration] - 持续时间（毫秒）；不传则用 setDefaultToastDuration 设置的值，0 表示不自动消失。
 * @returns {void}
 */
export function showToastI18n(type = 'info', key, params = {}, duration) {
	const div = base_showToast(type, '', duration)
	if (Object.keys(params).length) setLocalizeLogic(div, () => {
		div.querySelector('div').innerHTML = geti18n(key, params).replace(/\n/g, '<br>')
	})
	else div.querySelector('div').dataset.i18n = key
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
