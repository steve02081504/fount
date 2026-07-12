/** @type {Map<string, object>} */
const bridgeOpsRegistry = new Map()

/**
 * bot 壳启动时注册平台 bridgeOps（M5/M6 消费）。
 * @param {string} platform 平台标识
 * @param {object} ops bridgeOps 鸭子类型
 * @returns {void}
 */
export function registerBridgeOps(platform, ops) {
	bridgeOpsRegistry.set(String(platform), ops)
}

/**
 * @param {string} platform 平台标识
 * @returns {object | undefined} 已注册 ops
 */
export function resolveBridgeOps(platform) {
	return bridgeOpsRegistry.get(String(platform))
}

/**
 * @param {string} platform 平台标识
 * @param {string} op 操作名
 * @returns {Function} 已注册操作
 */
export function requireBridgeOp(platform, op) {
	const ops = resolveBridgeOps(platform)
	const fn = ops?.[op]
	if (typeof fn !== 'function')
		throw new Error(`bridge op not registered: ${platform}.${op}`)
	return fn
}
