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
