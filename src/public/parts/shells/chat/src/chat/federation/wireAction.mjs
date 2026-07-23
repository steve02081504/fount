/**
 * 将 room 的 wire action 绑定到 senderRegistry。
 * @param {object} roomContext 房间上下文（含 wireActions 与 senderRegistry）
 * @param {string} name action 名称
 * @returns {{ send: Function, on: (handler: Function) => void }} 发送函数与注册回调
 */
export function wireAction(roomContext, name) {
	const send = roomContext.wireActions.sender(name)
	roomContext.senderRegistry.set(name, send)
	return {
		send,
		/**
		 * 注册该 action 的入站 handler。
		 * @param {Function} handler 入站回调
		 * @returns {void}
		 */
		on: handler => { roomContext.wireActions.on(name, handler) },
	}
}
