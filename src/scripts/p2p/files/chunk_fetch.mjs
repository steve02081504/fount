import { randomUUID } from 'node:crypto'

import { b64ToU8, u8ToB64 } from '../bytes_codec.mjs'
import { FEDERATION_CHUNK_FETCH_FANOUT_K } from '../constants.mjs'
import { sha256Hex } from '../crypto.mjs'
import { isHex64 } from '../hexIds.mjs'
import { DEFAULT_TRUST_GRAPH_OWNER, requireTrustGraphProvider } from '../trust_graph_registry.mjs'

import { fetchFederationChunk, resolveNodeHash } from './chunk_provider_registry.mjs'
import { getChunk, hasChunk, putChunk } from './chunk_store.mjs'

/**
 * @param {string} chunkHash 期望的 64 hex 密文哈希
 * @param {Uint8Array | Buffer | null | undefined} data 块字节
 * @returns {boolean} 是否与 hash 一致
 */
export function chunkBytesMatchHash(chunkHash, data) {
	const hash = String(chunkHash || '').trim().toLowerCase()
	if (!isHex64(hash) || !data?.byteLength) return false
	return sha256Hex(data) === hash
}

/**
 * @param {string} chunkHash 期望哈希
 * @param {Uint8Array | Buffer} data 块字节
 * @returns {Uint8Array | null} 校验通过的数据；否则 null
 */
export function verifiedChunkBytes(chunkHash, data) {
	if (!chunkBytesMatchHash(chunkHash, data)) return null
	return data instanceof Uint8Array ? data : new Uint8Array(data)
}

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
			expectedHash: hash,
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
	const verified = verifiedChunkBytes(hash, result)
	if (verified) {
		await putChunk( hash, verified)
		return verified
	}

	return null
}

/** @type {Map<string, { expectedHash: string, resolve: (v: Uint8Array | null) => void }>} */
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
			const bytes = b64ToU8(String(payload.dataB64))
			entry.resolve(verifiedChunkBytes(entry.expectedHash, bytes))
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
	if (!await hasChunk( hash)) return
	const chunkBytes = await getChunk( hash)
	if (!chunkBytes?.length) return
	sendResponse({ requestId: payload.requestId, dataB64: u8ToB64(chunkBytes) }, peerId)
}
