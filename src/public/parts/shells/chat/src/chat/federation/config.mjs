import {
	getNodeTransportSettings,
	saveNodeTransportSettings,
} from '../../../../../../../scripts/p2p/node/identity.mjs'
import { events } from '../../../../../../../server/events.mjs'
import {
	ensureOperatorPubKey,
	getFederationViewForUser,
	getOperatorSecretKey,
	saveFederationViewForUser,
} from '../../../../../../../server/p2p_server/operator_identity.mjs'

import { invalidateAllFederationPartitionsForUser } from './registry.mjs'

/**
 * @param {string} username 用户名
 * @returns {void}
 */
export function invalidateAllFederationRoomsForUser(username) {
	invalidateAllFederationPartitionsForUser(username)
}

events.on('federation-settings-changed', ({ username }) => {
	invalidateAllFederationRoomsForUser(username)
	void import('../stream/signing.mjs')
		.then(module => module.invalidateStreamSignerCache(username))
		.catch(error => console.warn('federation: invalidateStreamSignerCache failed', error))
})

/**
 * @param {string} username 用户
 * @returns {Promise<object>} 节点传输 + operator 公钥
 */
export async function getFederationSettings(username) {
	return getFederationViewForUser(username)
}

/**
 * @param {string} username 用户
 * @returns {Promise<string>} operator 私钥 hex
 */
export async function getFederationIdentitySecret(username) {
	return getOperatorSecretKey(username)
}

/**
 * @param {string} username 用户
 * @returns {Promise<string>} operator 公钥 hex
 */
export async function ensureNodeIdentityPubKey(username) {
	return ensureOperatorPubKey(username)
}

/**
 * @param {string} username 用户
 * @param {object} patch 补丁
 * @returns {Promise<object>} 保存后的联邦视图
 */
export async function saveFederationSettings(username, patch) {
	return saveFederationViewForUser(username, patch)
}
/** 节点级传输配置直接透传给上层调用方。 */
export { getNodeTransportSettings, saveNodeTransportSettings }
