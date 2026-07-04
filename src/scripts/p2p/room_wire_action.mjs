/**
 * @param {object} roomContext
 * @param {string} name
 * @returns {{ send: Function, on: (handler: Function) => void }}
 */
export function wireAction(roomContext, name) {
	const send = roomContext.wireActions.sender(name)
	roomContext.senderRegistry.set(name, send)
	return {
		send,
		on: handler => { roomContext.wireActions.on(name, handler) },
	}
}
