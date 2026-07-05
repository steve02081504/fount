import { randomUUID } from 'node:crypto'

import { u8ToB64 } from '../bytes_codec.mjs'
import {
	MAX_PENDING_CHUNK_FETCHES,
	pendingChunkFetches,
	registerChunkFetchWait,
} from '../chunk_fetch_pending.mjs'
import { FEDERATION_CHUNK_FETCH_FANOUT_K } from '../constants.mjs'
import { ensureLinkToNode, listLinks } from '../link_registry.mjs'
import { loadNetwork } from '../network.mjs'
import { DEFAULT_TRUST_GRAPH_OWNER, requireTrustGraphProvider } from '../trust_graph_registry.mjs'

import { verifiedChunkBytes } from './chunk_fetch_verify.mjs'
import { fetchFederationChunk, resolveNodeHash } from './chunk_provider_registry.mjs'
import { getChunk, hasChunk, putChunk } from './chunk_store.mjs'

/**
 * @typedef {{
 *   username: string,
 *   ciphertextHash: string,
 *   ownerEntityHash?: string,
 *   groupId?: string,
 * }} FetchChunkContext
 */

/**
 * @returns {string[]} 全局 CAS miss 时应尝试拨号/发送的 nodeHash 列表
 */
function chunkFetchPeerTargets() {
	/** @type {Set<string>} */
	const targets = new Set()
	for (const { nodeHash } of listLinks())
		if (nodeHash) targets.add(String(nodeHash).toLowerCase())
	const net = loadNetwork()
	for (const nodeHash of [...net.trustedPeers || [], ...net.explorePeers || []])
		if (nodeHash) targets.add(String(nodeHash).toLowerCase())
	for (const hint of net.hints || [])
		if (hint?.nodeHash) targets.add(String(hint.nodeHash).toLowerCase())
	return [...targets]
}

/**
 * @param {FetchChunkContext} context 上下文
 * @returns {Promise<Uint8Array | null>} 密文块
 */
export async function fetchChunk(context) {
	const hash = String(context.ciphertextHash || '').trim().toLowerCase()
	const username = context.username
	if (!hash || !username) return null

	if (await hasChunk( hash))
		return new Uint8Array(await getChunk( hash))

	if (context.groupId) {
		const u8 = await fetchFederationChunk(username, context.groupId, hash)
		const verified = verifiedChunkBytes(hash, u8)
		if (verified) {
			await putChunk( hash, verified)
			return verified
		}
	}

	if (pendingChunkFetches.size >= MAX_PENDING_CHUNK_FETCHES) return null

	const requestId = randomUUID()
	const { done } = registerChunkFetchWait(requestId, hash, 8000)
	const { nodeHash } = await resolveNodeHash(username)
	const payload = {
		requestId,
		nodeHash,
		chunkHash: hash,
		ownerEntityHash: context.ownerEntityHash,
	}
	const graph = await requireTrustGraphProvider(DEFAULT_TRUST_GRAPH_OWNER).buildMergedGraph(username)
	const peerTargets = chunkFetchPeerTargets()
	await Promise.all(peerTargets.map(nodeHash => ensureLinkToNode(nodeHash).catch(() => null)))
	const tg = requireTrustGraphProvider(DEFAULT_TRUST_GRAPH_OWNER)
	// 已直连 / follow hint peer 可能不在 trust-graph top-K（非成员 emoji CAS / Social 预览路径）。
	for (const nodeHash of peerTargets)
		void tg.sendToNode(username, nodeHash, 'fed_chunk_get', payload, graph)
	await tg.fanoutToTopNodes(
		username,
		'fed_chunk_get',
		payload,
		FEDERATION_CHUNK_FETCH_FANOUT_K,
	)
	const result = await done
	const verified = verifiedChunkBytes(hash, result)
	if (verified) {
		await putChunk( hash, verified)
		return verified
	}

	return null
}

/**
 * 若本机有 chunk 则响应 fed_chunk_get。
 * @param {string} username 用户
 * @param {object} payload 请求
 * @param {(response: object, peerId: string) => void} sendResponse 发送
 * @param {string} peerId 对端
 * @returns {Promise<void>}
 */
export async function handleIncomingChunkGet(username, payload, sendResponse, peerId) {
	const hash = String(payload?.chunkHash || '').trim().toLowerCase()
	if (!hash) return
	if (!await hasChunk( hash)) return
	const chunkBytes = await getChunk( hash)
	if (!chunkBytes?.length) return
	sendResponse({ requestId: payload.requestId, dataB64: u8ToB64(chunkBytes) }, peerId)
}
