export async function do_notification(title, options) {
	if (Notification?.permission != 'granted') return
	try { return new Notification(title, options) }
	catch (_) {
		return navigator?.serviceWorker?.ready?.then?.((registration) => {
			registration.showNotification(title, options)
		})
	}
}
