const data = {}
export const events = {
	on(eventName, listener) {
		data[eventName] ??= []
		data[eventName].push(listener)
	},
	emit(eventName, ...args) {
		data[eventName]?.forEach?.(listener => listener(...args))
	},
	off(eventName, listenerToRemove) {
		if (!data[eventName]) return
		data[eventName] = data[eventName].filter(listener => listener !== listenerToRemove)
	}
}
