/**
 * 一个简单的事件发射器实现。
 * @type {object}
 */
const data = {}
/**
 * 一个简单的事件发射器。
 */
export const events = {
	/**
	 * 为给定的事件名称注册一个事件监听器。
	 * @param {string} eventName - 要监听的事件的名称。
	 * @param {Function} listener - 事件触发时执行的回调函数。
	 * @returns {void}
	 */
	on(eventName, listener) {
		data[eventName] ??= []
		data[eventName].push(listener)
	},
	/**
	 * 使用给定的名称和参数触发一个事件。
	 * @param {string} eventName - 要触发的事件的名称。
	 * @param {...*} args - 传递给事件监听器的参数。
	 * @returns {Promise<void>}
	 */
	async emit(eventName, ...args) {
		if (!data[eventName]) return
		for (const listener of data[eventName])
			await listener(...args)
	},
	/**
	 * 为给定的事件名称移除一个事件监听器。
	 * @param {string} eventName - 要从中移除监听器的事件的名称。
	 * @param {Function} listenerToRemove - 要移除的监听器函数。
	 * @returns {void}
	 */
	off(eventName, listenerToRemove) {
		if (!data[eventName]) return
		data[eventName] = data[eventName].filter(listener => listener !== listenerToRemove)
	}
}
