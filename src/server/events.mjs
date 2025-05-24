const data = {}
export const events = {
	on(eventName, listener) {
		data[eventName] ??= []
		data[eventName].push(listener)
	},
	async emit(eventName, ...args) {
		if (!data[eventName]) return
		for (const listener of data[eventName])
			await listener(...args)
	},
	off(eventName, listenerToRemove) {
		if (!data[eventName]) return
		data[eventName] = data[eventName].filter(listener => listener !== listenerToRemove)
	}
}
