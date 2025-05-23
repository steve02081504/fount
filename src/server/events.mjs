const data = {}
export const events = {
	on(eventName, listener) {
		data[eventName] ??= []
		this.events[eventName].push(listener)
	},
	emit(eventName, ...args) {
		data[eventName]?.forEach?.(listener => listener(...args))
	},
	off(eventName, listenerToRemove) {
		if (!this.events[eventName]) return
		this.events[eventName] = this.events[eventName].filter(listener => listener !== listenerToRemove)
	}
}
