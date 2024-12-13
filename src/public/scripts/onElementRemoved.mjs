export function onElementRemoved(element, callback) {
	let observer = new MutationObserver(function (mutations) {
		if (!document.body.contains(element)) {
			callback()
			this.disconnect()
		}
	})
	let interval = setInterval(() => {
		if (document.body.contains(element)) {
			observer.observe(element.parentElement, { childList: true })
			clearInterval(interval)
		}
	}, 100)
}
