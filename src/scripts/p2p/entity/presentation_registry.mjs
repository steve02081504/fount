/** @type {((replicaUsername: string, entityHash: string, locales: string[]) => Promise<object>) | null} */
let infoDefaultsProvider = null

/** @type {((req: import('npm:express').Request, replicaUsername: string) => string[]) | null} */
let localesFromRequestProvider = null

/**
 * @param {(replicaUsername: string, entityHash: string, locales: string[]) => Promise<object>} provider 资料默认值解析器
 * @returns {void}
 */
export function registerEntityPresentationProvider(provider) {
	infoDefaultsProvider = provider
}

/**
 * @param {(req: import('npm:express').Request, replicaUsername: string) => string[]} provider 请求区域设置解析器
 * @returns {void}
 */
export function registerLocalesFromRequestProvider(provider) {
	localesFromRequestProvider = provider
}

/**
 * @param {string} replicaUsername 查看者 replica
 * @param {string} entityHash 目标实体
 * @param {string[]} locales 区域设置优先级
 * @returns {Promise<object | null>} 展示默认值或 null
 */
export async function resolveInfoDefaultsForEntity(replicaUsername, entityHash, locales) {
	if (!infoDefaultsProvider) return null
	return infoDefaultsProvider(replicaUsername, entityHash, locales)
}

/**
 * @param {import('npm:express').Request} req HTTP 请求
 * @param {string} replicaUsername 查看者 replica
 * @returns {string[]} 区域设置列表
 */
export function localesFromRequest(req, replicaUsername) {
	if (localesFromRequestProvider) return localesFromRequestProvider(req, replicaUsername)
	return ['zh-CN', 'en-UK']
}
