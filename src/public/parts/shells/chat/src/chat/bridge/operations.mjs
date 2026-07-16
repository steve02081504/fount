/** @type {Map<string, { bridgeOperations: object, teardown?: () => void | Promise<void>, charname?: string }>} */
const bridgeOperationsRegistry = new Map()

/**
 * @param {string} username replica
 * @param {string} platform 平台标识
 * @param {string} botname bot 实例名
 * @returns {string} registry 键
 */
function registryKey(username, platform, botname) {
	return `${username}:${String(platform)}:${String(botname)}`
}

/**
 * bot 壳启动时注册 per-bot bridgeOperations（操作面 / ChatClient 消费）。
 * @param {string} username replica
 * @param {string} platform 平台标识
 * @param {string} botname bot 实例名
 * @param {object} bridgeOperations bridgeOperations 鸭子类型
 * @param {{ teardown?: () => void | Promise<void>, charname?: string }} [meta] 停止时清理与 char 关联
 * @returns {void}
 */
export function registerBridgeOperations(username, platform, botname, bridgeOperations, meta = {}) {
	bridgeOperationsRegistry.set(registryKey(username, platform, botname), {
		bridgeOperations,
		teardown: meta.teardown,
		charname: meta.charname,
	})
}

/**
 * 注销 per-bot bridgeOperations 并执行 teardown。
 * @param {string} username replica
 * @param {string} platform 平台标识
 * @param {string} botname bot 实例名
 * @returns {Promise<void>}
 */
export async function unregisterBridgeOperations(username, platform, botname) {
	const key = registryKey(username, platform, botname)
	const entry = bridgeOperationsRegistry.get(key)
	if (!entry) return
	bridgeOperationsRegistry.delete(key)
	await entry.teardown?.()
}

/**
 * @param {string} username replica
 * @param {{ platform: string, botname: string }} bridge 群 bridge 设置
 * @returns {object | undefined} 已注册 bridgeOperations
 */
export function resolveBridgeOperations(username, { platform, botname }) {
	return bridgeOperationsRegistry.get(registryKey(username, platform, botname))?.bridgeOperations
}

/**
 * @param {string} username replica
 * @param {{ platform: string, botname: string }} bridge 群 bridge 设置
 * @param {string} operationName 操作名
 * @returns {Function} 已注册操作
 */
export function requireBridgeOperation(username, bridge, operationName) {
	const platform = bridge?.platform
	const botname = bridge?.botname
	if (!platform || !botname)
		throw new Error(`bridge operation requires platform and botname: ${operationName}`)
	const fn = resolveBridgeOperations(username, { platform, botname })?.[operationName]
	if (!fn) throw new Error(`bridge operation not registered: ${platform}:${botname}.${operationName}`)
	return fn
}

/**
 * 枚举本 replica 运行中的 bridge bot。
 * @param {string} username replica
 * @returns {Array<{ platform: string, botname: string, bridgeOperations: object }>} 运行中 bot 列表
 */
export function listBridgeBots(username) {
	const prefix = `${username}:`
	/** @type {Array<{ platform: string, botname: string, bridgeOperations: object }>} */
	const rows = []
	for (const [key, entry] of bridgeOperationsRegistry.entries()) {
		if (!key.startsWith(prefix)) continue
		const rest = key.slice(prefix.length)
		const colon = rest.indexOf(':')
		if (colon < 0) continue
		rows.push({
			platform: rest.slice(0, colon),
			botname: rest.slice(colon + 1),
			bridgeOperations: entry.bridgeOperations,
		})
	}
	return rows
}
