/** @type {Map<string, { ops: object, teardown?: () => void | Promise<void>, charname?: string }>} */
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
 * @param {object} ops bridgeOperations 鸭子类型
 * @param {{ teardown?: () => void | Promise<void>, charname?: string }} [meta] 停止时清理与 char 关联
 * @returns {void}
 */
export function registerBridgeOperations(username, platform, botname, ops, meta = {}) {
	bridgeOperationsRegistry.set(registryKey(username, platform, botname), {
		ops,
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
 * @returns {object | undefined} 已注册 ops
 */
export function resolveBridgeOperations(username, { platform, botname }) {
	return bridgeOperationsRegistry.get(registryKey(username, platform, botname))?.ops
}

/**
 * @param {string} username replica
 * @param {{ platform: string, botname: string }} bridge 群 bridge 设置
 * @param {string} op 操作名
 * @returns {Function} 已注册操作
 */
export function requireBridgeOperation(username, bridge, op) {
	const platform = bridge?.platform
	const botname = bridge?.botname
	if (!platform || !botname)
		throw new Error(`bridge op requires platform and botname: ${op}`)
	const fn = resolveBridgeOperations(username, { platform, botname })?.[op]
	if (!fn) throw new Error(`bridge op not registered: ${platform}:${botname}.${op}`)
	return fn
}

/**
 * 枚举本 replica 运行中的 bridge bot。
 * @param {string} username replica
 * @returns {Array<{ platform: string, botname: string, ops: object }>} 运行中 bot 列表
 */
export function listBridgeBots(username) {
	const prefix = `${username}:`
	/** @type {Array<{ platform: string, botname: string, ops: object }>} */
	const rows = []
	for (const [key, entry] of bridgeOperationsRegistry.entries()) {
		if (!key.startsWith(prefix)) continue
		const rest = key.slice(prefix.length)
		const colon = rest.indexOf(':')
		if (colon < 0) continue
		rows.push({
			platform: rest.slice(0, colon),
			botname: rest.slice(colon + 1),
			ops: entry.ops,
		})
	}
	return rows
}
