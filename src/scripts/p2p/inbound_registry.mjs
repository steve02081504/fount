/** @typedef {import('./part_invoke.mjs').PartInvokeResponse} PartInvokeResponse */

/**
 * @typedef {{
 *   replicaUsername?: string
 *   requesterNodeHash?: string | null
 *   groupId?: string
 *   peerId?: string
 * }} InboundContext
 */

/**
 * @typedef {(ctx: InboundContext, message: object) => Promise<PartInvokeResponse | null | void>} InboundHandler
 */

/** @type {Map<string, InboundHandler>} */
const handlers = new Map()

/**
 * @param {string} type 入站类型（part_invoke、part_timeline_put、mailbox_give 等）
 * @param {InboundHandler} handler 处理器
 * @returns {void}
 */
export function registerInboundHandler(type, handler) {
	handlers.set(String(type || '').trim(), handler)
}

/**
 * @param {string} type 入站类型
 * @returns {void}
 */
export function unregisterInboundHandler(type) {
	handlers.delete(String(type || '').trim())
}

/**
 * @param {InboundContext} ctx 入站上下文
 * @param {object} message 已校验的线载荷（含 type）
 * @returns {Promise<PartInvokeResponse | null | void>} 处理器返回值
 */
export async function dispatchInbound(ctx, message) {
	const type = String(message?.type || '').trim()
	if (!type) return null
	const handler = handlers.get(type)
	if (!handler) return null
	return handler(ctx, message)
}

/** @returns {void} 测试用 */
export function clearInboundHandlers() {
	handlers.clear()
}
