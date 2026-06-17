import { parseEntityHash } from '../entity_id.mjs'
import { operatorEntityHashFromKeys } from '../node/identity.mjs'
import { getNodeHash } from '../node_context.mjs'

/**
 * @param {string} operatorPubKeyHex 64 hex
 * @returns {string | null} 本节点操作者 entityHash
 */
export function resolveLocalOperatorEntityHash(operatorPubKeyHex) {
	return operatorEntityHashFromKeys(getNodeHash(), operatorPubKeyHex)
}

/**
 * @param {string} entityHash 目标 entityHash
 * @returns {boolean} 是否为本节点可写实体
 */
export function isWritableLocalEntity(entityHash) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return false
	return parsed.nodeHash === getNodeHash()
}
