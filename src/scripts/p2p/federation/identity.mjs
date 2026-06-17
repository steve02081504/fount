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
 * @param _username
 * @deprecated 使用 ensureNodeDefaults
 */
export function ensureFederationDefaults(_username) {
	void _username
	return ensureNodeDefaults()
}

/**
 * @param _username
 * @deprecated 使用 getNodeTransportSettings
 */
export function getFederationSettings(_username) {
	void _username
	return getNodeTransportSettings()
}

/**
 * @param {string} _username 忽略
 * @param {object} patch 节点传输字段
 */
export function saveFederationSettings(_username, patch) {
	void _username
	return saveNodeTransportSettings(patch)
}

/**
 * @param _username
 * @deprecated 用户域 — 请用 p2p_server/operator_identity
 */
export function getFederationIdentitySecret(_username) {
	void _username
	throw new Error('getFederationIdentitySecret moved to p2p_server/operator_identity')
}

/**
 * @param _username
 * @param _nonce
 * @deprecated
 */
export function setDmIntroNonce(_username, _nonce) {
	void _username
	void _nonce
	throw new Error('setDmIntroNonce moved to p2p_server/operator_identity')
}
