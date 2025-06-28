export async function sendNotification(title, options) {
	if (window.Notification?.permission != 'granted') return
	try { return new Notification(title, options) }
	catch (_) {
		return navigator?.serviceWorker?.ready?.then?.((registration) => {
			registration.showNotification(title, options)
		})
	}
}
