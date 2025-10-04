const handlers = new Map()

/**
 * @param {string} type
 * @param {(data: any) => void} callback
 */
export function onServerEvent(type, callback) {
	if (!handlers.has(type))
		handlers.set(type, [])

	handlers.get(type).push(callback)
}

/**
 * @param {string} type
 * @param {(data: any) => void} callback
 */
export function offServerEvent(type, callback) {
	if (handlers.has(type)) {
		const typeHandlers = handlers.get(type)
		const index = typeHandlers.indexOf(callback)
		if (index > -1)
			typeHandlers.splice(index, 1)
	}
}

/**
 * To be called by base.mjs when a message from SW is received.
 * @param {{type: string, data: any}} message
 */
function dispatchMessage(message) {
	const { type, data } = message
	if (handlers.has(type))
		for (const handler of handlers.get(type)) try {
			handler(data)
		} catch (e) {
			console.error(`Error in message handler for type "${type}":`, e)
		}
}

if ('serviceWorker' in navigator)
	navigator.serviceWorker.addEventListener('message', event => {
		if (event.data)
			dispatchMessage(event.data)
	})
