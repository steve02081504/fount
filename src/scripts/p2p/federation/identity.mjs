/**
 * 节点级联邦传输配置（node.json）。
 * 用户 operator 身份见 `src/server/p2p_server/operator_identity.mjs`。
 */
import {
	ensureNodeDefaults,
	ensureNodeSeed,
	getNodeHash,
	getNodeTransportSettings,
	saveNodeTransportSettings,
	operatorEntityHashFromKeys,
} from '../node/identity.mjs'

/**
 *
 */
export {
	ensureNodeDefaults,
	ensureNodeSeed,
	getNodeHash,
	getNodeTransportSettings,
	saveNodeTransportSettings,
	operatorEntityHashFromKeys,
}

/**
 * @param {string} _username 忽略（兼容旧 API）
 * @returns {ReturnType<typeof ensureNodeDefaults>} 节点默认配置
 * @deprecated 使用 ensureNodeDefaults
 */
export function ensureFederationDefaults(_username) {
	void _username
	return ensureNodeDefaults()
}

/**
 * @param {string} _username 忽略（兼容旧 API）
 * @returns {ReturnType<typeof getNodeTransportSettings>} 节点传输配置
 * @deprecated 使用 getNodeTransportSettings
 */
export function getFederationSettings(_username) {
	void _username
	return getNodeTransportSettings()
}

/**
 * @param {string} _username 忽略（兼容旧 API）
 * @param {object} patch 节点传输字段
 * @returns {ReturnType<typeof saveNodeTransportSettings>} 保存后的配置
 */
export function saveFederationSettings(_username, patch) {
	void _username
	return saveNodeTransportSettings(patch)
}

/**
 * @param {string} _username 忽略
 * @returns {never} 始终抛错
 * @deprecated 用户域 — 请用 p2p_server/operator_identity
 */
export function getFederationIdentitySecret(_username) {
	void _username
	throw new Error('getFederationIdentitySecret moved to p2p_server/operator_identity')
}

/**
 * @param {string} _username 忽略
 * @param {string} _nonce 忽略
 * @returns {never} 始终抛错
 * @deprecated 已迁至 p2p_server/operator_identity
 */
export function setDmIntroNonce(_username, _nonce) {
	void _username
	void _nonce
	throw new Error('setDmIntroNonce moved to p2p_server/operator_identity')
}
