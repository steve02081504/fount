/**
 * Shell bootstrap 就绪信号（globalThis CustomEvent + 内存状态，不写 DOM attribute）。
 * 浏览器 shell 与 Playwright 共用；测试侧轮询 `globalThis.fount.test.getState(id)`。
 */

/** @typedef {'pending' | 'ready' | 'failed'} ReadyGateStatus */

/** @type {Map<string, { status: ReadyGateStatus, message?: string }>} */
const states = new Map()

/**
 * @param {{ id: string, readyEvent: string, errorEvent: string }} spec gate 定义
 * @returns {typeof spec & { markPending: () => void, markReady: () => void, markFailed: (error: Error) => void }} 可 mark 的 gate 实例
 */
export function createReadyGate(spec) {
	const { id, readyEvent, errorEvent } = spec

	return {
		...spec,
		/** @returns {void} */
		markPending() {
			states.set(id, { status: 'pending' })
		},
		/** @returns {void} */
		markReady() {
			states.set(id, { status: 'ready' })
			dispatchEvent(new CustomEvent(readyEvent, { detail: { id } }))
		},
		/**
		 * @param {Error} error 失败原因
		 * @returns {void}
		 */
		markFailed(error) {
			const message = error?.message ?? String(error)
			states.set(id, { status: 'failed', message })
			dispatchEvent(new CustomEvent(errorEvent, {
				detail: { id, message },
			}))
		},
	}
}

/**
 * @param {string} id gate id
 * @returns {{ status: ReadyGateStatus, message?: string }} 当前 gate 状态
 */
function getReadyGateState(id) {
	return states.get(id) ?? { status: 'pending' }
}

globalThis.fount ??= {}
globalThis.fount.test ??= {}
globalThis.fount.test.getState = getReadyGateState
