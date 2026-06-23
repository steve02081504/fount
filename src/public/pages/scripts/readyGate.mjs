/**
 * Shell bootstrap 就绪信号（DOM attribute + CustomEvent）。
 */

/**
 * @param {string} id 信号 id（用于 data-fount-{id}-* 与 fount:{id}-* 事件）
 * @returns {{ id: string, readyAttr: string, errorAttr: string, readyEvent: string, errorEvent: string }} attribute 与事件名
 */
export function readyGateAttrs(id) {
	return {
		id,
		readyAttr: `data-fount-${id}-ready`,
		errorAttr: `data-fount-${id}-error`,
		readyEvent: `fount:${id}-ready`,
		errorEvent: `fount:${id}-error`,
	}
}

/** Hub 全量 bootHub 完成后的就绪 attribute（与测试 waitForHubShellReady 共用）。 */
export const HUB_SHELL_GATE = readyGateAttrs('hub-shell')

/** Social bootstrapSocialApp 完成后的就绪 attribute。 */
export const SOCIAL_APP_GATE = readyGateAttrs('social-app')

/**
 * @param {ReturnType<typeof readyGateAttrs>} gateAttrs 预定义 gate（如 HUB_SHELL_GATE）
 * @param {string} label 人类可读标签（错误消息回退）
 * @returns {ReturnType<typeof createReadyGate>} 就绪标记函数
 */
export function createReadyGateFor(gateAttrs, label) {
	return createReadyGate({ id: gateAttrs.id, label })
}

/**
 * @param {object} opts 选项
 * @param {string} opts.id 信号 id
 * @param {string} opts.label 人类可读标签（错误消息回退）
 * @returns {ReturnType<typeof readyGateAttrs> & { markPending: () => void, markReady: () => void, markFailed: (error: unknown) => void }} 就绪标记函数
 */
export function createReadyGate({ id, label }) {
	const attrs = readyGateAttrs(id)
	const { readyAttr, errorAttr, readyEvent, errorEvent } = attrs

	return {
		...attrs,
		/** @returns {void} */
		markPending() {
			document.documentElement.removeAttribute(readyAttr)
			document.documentElement.removeAttribute(errorAttr)
		},
		/** @returns {void} */
		markReady() {
			document.documentElement.setAttribute(readyAttr, '')
			document.documentElement.removeAttribute(errorAttr)
			document.dispatchEvent(new CustomEvent(readyEvent))
		},
		/**
		 * @param {unknown} error 失败原因
		 * @returns {void}
		 */
		markFailed(error) {
			const err = error instanceof Error ? error : new Error(String(error))
			document.documentElement.removeAttribute(readyAttr)
			document.documentElement.setAttribute(errorAttr, err.message)
			document.dispatchEvent(new CustomEvent(errorEvent, {
				detail: { message: err.message },
			}))
		},
	}
}
