/**
 *
 */
export { getNodeHash, ensureNodeSeed, ensureNodeDefaults, getNodeTransportSettings, saveNodeTransportSettings } from './node/identity.mjs'

import { getNodeHash as _getNodeHash } from './node/identity.mjs'

/**
 * @returns {string} 本节点 64 hex nodeHash
 */
export function requireNodeHash() {
	const nodeHash = _getNodeHash()
	if (!nodeHash) throw new Error('p2p: nodeHash unavailable')
	return nodeHash
}
