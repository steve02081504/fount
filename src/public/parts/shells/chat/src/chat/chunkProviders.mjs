import {
	registerFederationChunkFetcher,
	registerNodeHashProvider,
	unregisterChunkProviders,
} from 'npm:@steve02081504/fount-p2p/files/chunk_provider_registry'
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'

import { fetchCiphertextFromFederation } from './federation/chunks.mjs'

const OWNER_ID = 'chat'

/**
 * 注册 Chat 联邦 chunk 与 nodeId 提供者。
 * @returns {void}
 */
export function registerChatChunkProviders() {
	registerFederationChunkFetcher(OWNER_ID, fetchCiphertextFromFederation)
	registerNodeHashProvider(OWNER_ID, () => ({ nodeHash: getNodeHash() }))
}

/** @returns {void} */
export function unregisterChatChunkProviders() {
	unregisterChunkProviders(OWNER_ID)
}
