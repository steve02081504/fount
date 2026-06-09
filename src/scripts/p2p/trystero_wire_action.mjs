/**
 * 联邦房间 Trystero action 绑定：注册 send 并返回 on 辅助。
 */

/**
 * @param {object} roomContext 房间上下文（wireActions + senderRegistry）
 * @param {string} name Trystero action
 * @returns {{ send: Function, on: (handler: Function) => void }} action 绑定
 */
export function wireAction(roomContext, name) {
	const send = roomContext.wireActions.sender(name)
	roomContext.senderRegistry.set(name, send)
	return {
		send,
		/** @param {(payload: unknown, peerId: string) => void} handler 入站处理器 */
		on: handler => { roomContext.wireActions.on(name, handler) },
	}
}
