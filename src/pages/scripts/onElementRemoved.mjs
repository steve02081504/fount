/**
 * @description 当元素从 DOM 中移除时调用回调函数。
 * @param {HTMLElement} element - 要观察的元素。
 * @param {Function} callback - 元素被移除时调用的回调函数。
 * @returns {void}
 */
export function onElementRemoved(element, callback) {
	const observer = new MutationObserver(function (mutations) {
		if (!document.body.contains(element)) {
			callback()
			this.disconnect()
		}
	})
	const interval = setInterval(() => {
		if (document.body.contains(element)) {
			observer.observe(element.parentElement, { childList: true })
			clearInterval(interval)
		}
	}, 100)
}
