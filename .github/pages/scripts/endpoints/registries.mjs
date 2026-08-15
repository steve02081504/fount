/**
 * GitHub Pages 无 fount 节点，registry 恒为空（`cp -n` 覆盖 src 同名脚本）。
 * @typedef {{ id: string, level: number, path: string }} RegistryEntry
 */

/**
 * @param {string} [_name] registry 名称
 * @param {{ nocache?: boolean }} [_options] 与节点客户端同签名
 * @returns {Promise<RegistryEntry[]>} 空列表
 */
export function getRegistry(_name, _options) {
	return Promise.resolve([])
}

/**
 * @param {string} [_name] registry 名称
 * @param {{ nocache?: boolean }} [_options] 与节点客户端同签名
 * @returns {Promise<Array<{ entry: RegistryEntry, module: unknown }>>} 空列表
 */
export function importRegistryModules(_name, _options) {
	return Promise.resolve([])
}
