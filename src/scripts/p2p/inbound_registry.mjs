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
 * @typedef {(ctx: InboundContext, message: object) => Promise<PartInvokeResponse | null>} RpcInboundHandler
 */

/**
 * @typedef {(ctx: InboundContext, message: object) => Promise<void>} DeliveryInboundHandler
 */

/** @type {Map<string, RpcInboundHandler>} */
const rpcHandlers = new Map()

/** @type {Map<string, DeliveryInboundHandler>} */
const deliveryHandlers = new Map()

/**
 * @param {string} type 入站 RPC 类型（part_invoke 等）
 * @param {RpcInboundHandler} handler 处理器
 * @returns {void}
 */
export function registerRpcInboundHandler(type, handler) {
	rpcHandlers.set(String(type || '').trim(), handler)
}

/**
 * @param {string} type 入站投递类型（part_timeline_put 等）
 * @param {DeliveryInboundHandler} handler 处理器
 * @returns {void}
 */
export function registerDeliveryInboundHandler(type, handler) {
	deliveryHandlers.set(String(type || '').trim(), handler)
}

/**
 * @param {string} type 入站类型
 * @returns {void}
 */
export function unregisterRpcInboundHandler(type) {
	rpcHandlers.delete(String(type || '').trim())
}

/**
 * @param {string} type 入站类型
 * @returns {void}
 */
export function unregisterDeliveryInboundHandler(type) {
	deliveryHandlers.delete(String(type || '').trim())
}

/**
 * @param {InboundContext} ctx 入站上下文
 * @param {object} message 已校验的线载荷（含 type）
 * @returns {Promise<PartInvokeResponse | null>} 处理器返回值
 */
export async function dispatchRpcInbound(ctx, message) {
	const type = String(message?.type || '').trim()
	if (!type) return null
	const handler = rpcHandlers.get(type)
	if (!handler) return null
	return handler(ctx, message)
}

/**
 * @param {InboundContext} ctx 入站上下文
 * @param {object} message 已校验的线载荷（含 type）
 * @returns {Promise<void>}
 */
export async function dispatchDeliveryInbound(ctx, message) {
	const type = String(message?.type || '').trim()
	if (!type) return
	const handler = deliveryHandlers.get(type)
	if (!handler) return
	await handler(ctx, message)
}

/** @returns {void} 测试用 */
export function clearInboundHandlers() {
	rpcHandlers.clear()
	deliveryHandlers.clear()
}
