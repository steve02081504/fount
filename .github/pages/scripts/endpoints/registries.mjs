/**
 * GitHub Pages 无 fount 节点，registry 恒为空（`cp -n` 覆盖 src 同名脚本）。
 * @typedef {{ id: string, level: number, path: string }} RegistryEntry
 */

/**
 * GitHub Pages 无 fount 节点，恒返回空条目列表。
 * @param {string} [registryName] registry 名称
 * @param {{ nocache?: boolean }} [options] 与节点客户端同签名
 * @returns {Promise<RegistryEntry[]>} 空列表
 */
export function getRegistry(registryName, options) {
	return Promise.resolve([])
}

/**
 * GitHub Pages 无 fount 节点，恒返回空模块列表。
 * @param {string} [registryName] registry 名称
 * @param {{ nocache?: boolean }} [options] 与节点客户端同签名
 * @returns {Promise<Array<{ entry: RegistryEntry, module: unknown }>>} 空列表
 */
export function importRegistryModules(registryName, options) {
	return Promise.resolve([])
}
