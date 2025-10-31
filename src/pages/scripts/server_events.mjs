const handlers = new Map()

/**
 * @description 注册一个服务器事件回调。
 * @param {string} type - 事件类型。
 * @param {(data: any) => void} callback - 回调函数。
 * @returns {void}
 */
export function onServerEvent(type, callback) {
	if (!handlers.has(type))
		handlers.set(type, [])

	handlers.get(type).push(callback)
}

/**
 * @description 注销一个服务器事件回调。
 * @param {string} type - 事件类型。
 * @param {(data: any) => void} callback - 回调函数。
 * @returns {void}
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
 * @description 由 base.mjs 在收到来自 SW 的消息时调用。
 * @param {{type: string, data: any}} message - 消息。
 * @returns {void}
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
