import { randomUUID } from 'node:crypto'

import { b64ToU8, u8ToB64 } from '../bytes_codec.mjs'
import { FEDERATION_CHUNK_FETCH_FANOUT_K } from '../constants.mjs'
import { DEFAULT_TRUST_GRAPH_OWNER, requireTrustGraphProvider } from '../trust_graph_registry.mjs'

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
 * @param {FetchChunkContext} context 上下文
 * @returns {Promise<Uint8Array | null>} 密文块
 */
export async function fetchChunk(context) {
	const hash = String(context.ciphertextHash || '').trim().toLowerCase()
	const username = context.username
	if (!hash || !username) return null

	if (await hasChunk(username, hash))
		return new Uint8Array(await getChunk(username, hash))

	if (context.groupId) {
		const u8 = await fetchFederationChunk(username, context.groupId, hash)
		if (u8?.byteLength) {
			await putChunk(username, hash, u8)
			return u8
		}
	}

	const requestId = randomUUID()
	/** @type {Uint8Array | null} */
	let result = null
	const done = new Promise(resolve => {
		const timer = setTimeout(() => {
			pendingChunkFetches.delete(requestId)
			resolve(null)
		}, 8000)
		if (pendingChunkFetches.size >= MAX_PENDING_CHUNK_FETCHES) {
			clearTimeout(timer)
			resolve(null)
			return
		}
		pendingChunkFetches.set(requestId, {
			/**
			 * @param {Uint8Array | null} data 块数据
			 * @returns {void}
			 */
			resolve: (data) => {
				clearTimeout(timer)
				result = data
				resolve(data)
			},
		})
	})
	const { nodeHash } = await resolveNodeHash(username)
	await requireTrustGraphProvider(DEFAULT_TRUST_GRAPH_OWNER).fanoutToTopNodes(username, 'fed_chunk_get', {
		requestId,
		nodeHash,
		chunkHash: hash,
		ownerEntityHash: context.ownerEntityHash,
	}, FEDERATION_CHUNK_FETCH_FANOUT_K)
	await done
	if (result) {
		await putChunk(username, hash, result)
		return result
	}

	return null
}

/** @type {Map<string, { resolve: (v: Uint8Array | null) => void }>} */
export const pendingChunkFetches = new Map()
const MAX_PENDING_CHUNK_FETCHES = 2048

/**
 * 处理入站 fed_chunk_get 响应数据。
 * @param {object} payload 载荷
 * @returns {void}
 */
export function resolvePendingChunkFetch(payload) {
	const requestId = String(payload?.requestId || '')
	const entry = pendingChunkFetches.get(requestId)
	if (!entry) return
	pendingChunkFetches.delete(requestId)
	if (payload?.dataB64) {
		try {
			entry.resolve(b64ToU8(String(payload.dataB64)))
		}
		catch {
			entry.resolve(null)
		}
		return
	}
	entry.resolve(null)
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
	if (!await hasChunk(username, hash)) return
	const chunkBytes = await getChunk(username, hash)
	if (!chunkBytes?.length) return
	sendResponse({ requestId: payload.requestId, dataB64: u8ToB64(chunkBytes) }, peerId)
}
