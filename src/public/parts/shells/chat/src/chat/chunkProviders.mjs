import {
	registerFederationChunkFetcher,
	registerNodeHashProvider,
	unregisterChunkProviders,
} from '../../../../../../scripts/p2p/files/chunk_provider_registry.mjs'
import { getNodeHash } from '../../../../../../scripts/p2p/node_context.mjs'

import { fetchCiphertextFromFederation } from './federation/chunks.mjs'

const OWNER_ID = 'chat'

/**
 * 注册 Chat 联邦 chunk 与 nodeId 提供者。
 * @returns {void}
 */
export function registerChatChunkProviders() {
	registerFederationChunkFetcher(OWNER_ID, fetchCiphertextFromFederation)
	registerNodeHashProvider(OWNER_ID, username => ({ nodeHash: getNodeHash(username) }))
}

/** @returns {void} */
export function unregisterChatChunkProviders() {
	unregisterChunkProviders(OWNER_ID)
}
