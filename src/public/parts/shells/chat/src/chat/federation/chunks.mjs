/**
 * 【文件】federation/chunks.mjs
 * 【职责】§10.2 群文件密文块 P2P 复制：经 Trystero fed_chunk_put/get/data/ack 在在线邻居间传播与拉取分块，并注册 swarm API 供 groupFiles 存储插件回调。
 * 【原理】attachFedChunkHandlers 在 ensureFederationRoom 时挂载；本地 put 后 replicateChunkToRoster 广播，缺失时 fetchChunkFromRoster 广播 get 并等待 fed_chunk_data。replicateChunkToFederation 可等待 M_eff 个 ACK。createFederationSwarmStoragePlugin 在本地 miss 时回退联邦 fetch。
 * 【数据结构】载荷 { chunkHash, dataB64? }；swarmApis Map 键 username\0groupId；pendingFetches 等待密文字节。
 * 【关联】files/chunkReplicationAck.mjs、chunkRefcount.mjs、groupFiles.mjs、room.mjs、governance/reputation.mjs；scripts/p2p/storage_plugins.mjs。
 */
import { debugLog } from '../../../../../../../scripts/debug_log.mjs'
import { b64ToU8, u8ToB64 } from '../../../../../../../scripts/p2p/bytes_codec.mjs'
import {
	assignChunksToPeers,
	markChunkDone,
	markChunkFailed,
	markChunkInflight,
	planChunkFetches,
} from '../../../../../../../scripts/p2p/chunk_fetch_scheduler.mjs'
import { compositeKey } from '../../../../../../../scripts/p2p/composite_key.mjs'
import { FEDERATION_CHUNK_MAX_BYTES } from '../../../../../../../scripts/p2p/constants.mjs'
import { handleIncomingChunkGet, resolvePendingChunkFetch } from '../../../../../../../scripts/p2p/files/chunk_fetch.mjs'
import { getChunk, hasChunk } from '../../../../../../../scripts/p2p/files/chunk_store.mjs'
import { HEX_ID_64, LOCAL_CHUNK_FILE_RE } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { bumpChunkStorageReputation } from '../../../../../../../scripts/p2p/reputation_user.mjs'
import { isFederationActionAllowedUnderLoad } from '../../../../../../../scripts/p2p/rtc_connection_budget.mjs'
import { createLocalStoragePlugin } from '../../../../../../../scripts/p2p/storage_plugins.mjs'
import { isPlainObject } from '../../../../../../../scripts/p2p/wire_ingress.mjs'
import { consumeWireRateBucket } from '../../../../../../../scripts/p2p/wire_rate_bucket.mjs'
import { bumpChunkLocalRef } from '../files/chunkRefcount.mjs'
import { beginChunkReplicationWait, recordChunkReplicationAck } from '../files/chunkReplicationAck.mjs'
import { shellChatRoot } from '../lib/paths.mjs'

const FETCH_TIMEOUT_MS = 14_000
const DEFAULT_FETCH_CONCURRENCY = 6
const CHUNK_HASH_RE = HEX_ID_64
const CHUNK_REPLICATE_MAX_PER_MIN = 60
const CHUNK_REPLICATE_BYTES_PER_MIN = 8 * 1024 * 1024

/**
 * @param {string} bucketKey 房间键
 * @param {number} byteCount 字节数
 * @returns {boolean} 是否允许
 */
function consumeChunkRate(bucketKey, byteCount) {
	return consumeWireRateBucket(bucketKey, {
		maxCount: CHUNK_REPLICATE_MAX_PER_MIN,
		byteCount,
		maxBytesPerWindow: CHUNK_REPLICATE_BYTES_PER_MIN,
	})
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @returns {string} 注册表键
 */
function registryKey(username, groupId) {
	return compositeKey(username, groupId)
}

/** @type {Map<string, { replicate: Function, fetch: Function }>} */
const swarmApis = new Map()

/** @type {Map<string, { resolve: (v: Uint8Array) => void, reject: (e: Error) => void, timer: ReturnType<typeof setTimeout> }>} */
const pendingFetches = new Map()

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {{ replicate: (chunkHash: string, data: Uint8Array) => Promise<void>, fetch: (chunkHash: string) => Promise<Uint8Array> }} api 复制/拉取
 * @returns {void}
 */
export function registerChunkSwarm(username, groupId, api) {
	swarmApis.set(registryKey(username, groupId), api)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @returns {void}
 */
export function unregisterChunkSwarm(username, groupId) {
	swarmApis.delete(registryKey(username, groupId))
}

/**
 * 新上传密文块后向已注册联邦房广播复制（§10.2）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} ciphertextHash 密文 SHA-256 hex
 * @param {Uint8Array} data 密文字节
 * @returns {Promise<void>}
 */
/**
 * 向联邦邻居复制密文块，并按需等待 ACK（§10.2 `M_eff`）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} ciphertextHash 密文哈希
 * @param {Uint8Array} data 密文
 * @param {{ requiredAcks?: number, timeoutMs?: number }} [opts] 复制选项
 * @returns {Promise<{ acked: number, required: number, timedOut: boolean, unavailable?: boolean }>} ACK 统计
 */
export async function replicateChunkToFederation(username, groupId, ciphertextHash, data, opts = {}) {
	const requiredAcks = Math.max(0, Math.floor(Number(opts.requiredAcks) || 0))
	const waitPromise = beginChunkReplicationWait(
		username,
		groupId,
		ciphertextHash,
		requiredAcks,
		opts.timeoutMs ?? 5000,
	)
	const api = swarmApis.get(registryKey(username, groupId))
	if (!api?.replicate) {
		if (requiredAcks > 0)
			return { acked: 0, required: requiredAcks, timedOut: true, unavailable: true }
		return { acked: 0, required: 0, timedOut: false }
	}
	await api.replicate(ciphertextHash, data)
	return await waitPromise
}

/**
 * 向已注册联邦邻居拉取缺失密文块（§10.2）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} ciphertextHash 密文 SHA-256 hex
 * @returns {Promise<Uint8Array>} 密文字节
 */
export async function fetchCiphertextFromFederation(username, groupId, ciphertextHash) {
	const hash = String(ciphertextHash || '').trim().toLowerCase()
	if (!CHUNK_HASH_RE.test(hash)) throw new Error('invalid ciphertextHash')
	const api = swarmApis.get(registryKey(username, groupId))
	if (!api?.fetch) throw new Error('federation chunk fetch unavailable')
	return await api.fetch(hash)
}

/**
 * @param {string} username 用户
 * @returns {import('../../../../../../../scripts/p2p/storage_plugins.mjs').GroupStoragePlugin} 本地插件
 */
function localPlugin(username) {
	return createLocalStoragePlugin(shellChatRoot(username))
}

/**
 * P2P 联邦分块存储：本地落盘 + 在线邻居复制；缺失时向邻居索要。
 * @param {string} baseDir shells/chat 根
 * @param {string} username 用户
 * @param {string} groupId 群
 * @returns {object} 存储插件
 */
export function createFederationSwarmStoragePlugin(baseDir, username, groupId) {
	const local = createLocalStoragePlugin(baseDir)
	const key = registryKey(username, groupId)
	return {
		storagePeerId: 'federation_swarm',
		/**
		 * @param {string} groupId 群 id
		 * @param {string} chunkHash 内容哈希
		 * @param {Uint8Array} data 密文块
		 * @returns {Promise<{ storageLocator: string }>} 本地定位符
		 */
		async putChunk(groupId, chunkHash, data) {
			return await local.putChunk(groupId, chunkHash, data)
		},
		/**
		 * @param {string} locator 定位符
		 * @returns {Promise<Uint8Array>} 密文块字节
		 */
		async getChunk(locator) {
			try {
				return await local.getChunk(locator)
			}
			catch (firstErr) {
				const match = String(locator).match(LOCAL_CHUNK_FILE_RE)
				const hash = match?.[1]?.toLowerCase()
				const api = swarmApis.get(key)
				if (!hash || !api?.fetch) throw firstErr
				return await api.fetch(hash)
			}
		},
		/**
		 * @param {string} locator 定位符
		 * @returns {Promise<void>}
		 */
		deleteChunk(locator) {
			return local.deleteChunk(locator)
		},
	}
}

/**
 * 向当前房内邻居广播密文块（限速；§10.2）。
 * @param {object} slot 联邦槽
 * @param {string} chunkHash 块哈希
 * @param {Uint8Array} data 密文
 * @param {string} bucketKey 限速键
 * @param {{ fedOut?: { enqueue: (prio: number, fn: () => void) => void } }} [opts] 出站队列
 * @returns {Promise<void>}
 */
function replicateChunkToRoster(slot, chunkHash, data, bucketKey, opts = {}) {
	if (data.byteLength > FEDERATION_CHUNK_MAX_BYTES) return
	if (!consumeChunkRate(bucketKey, data.byteLength)) return
	const payload = { chunkHash, dataB64: u8ToB64(data) }
	const roster = slot.getRoster()
	const targets = roster.slice(0, 1)
	/**
	 * 将 `fed_chunk_put` 发往单个对等端（吞掉网络层异常）。
	 * @param {string} peerId 对等端 id
	 * @returns {void}
	 */
	const dispatch = peerId => {
		try { slot.sendToPeer(peerId, 'fed_chunk_put', payload) }
		catch (err) {
			console.error('federation: fed_chunk_put send failed', err)
			void debugLog('federation', { scope: 'fed_chunk_put', peerId, message: err?.message })
				.catch(error => console.warn('federation: fed_chunk_put debugLog failed', error))
		}
	}
	for (const { peerId } of targets)
		if (opts.fedOut)
			opts.fedOut.enqueue(5, () => dispatch(peerId))
		else
			dispatch(peerId)
}

/**
 * 向单个 peer 请求分块并等待 `fed_chunk_data`。
 * @param {object} slot 联邦槽
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} chunkHash 块哈希
 * @param {string | null} peerId 目标 peer；null 则广播
 * @returns {Promise<Uint8Array>} 密文块
 */
function fetchChunkFromPeer(slot, username, groupId, chunkHash, peerId) {
	const waitKey = compositeKey(username, groupId, chunkHash)
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			pendingFetches.delete(waitKey)
			reject(new Error('fed_chunk_get timeout'))
		}, FETCH_TIMEOUT_MS)
		pendingFetches.set(waitKey, { resolve, reject, timer })
		const payload = { chunkHash }
		if (peerId) {
			try { slot.sendToPeer(peerId, 'fed_chunk_get', payload) }
			catch (error) { reject(error instanceof Error ? error : new Error(String(error))) }
			return
		}
		const roster = slot.getRoster()
		for (const { peerId: targetPeerId } of roster)
			try { slot.sendToPeer(targetPeerId, 'fed_chunk_get', payload) }
			catch (err) {
				console.error('federation: fed_chunk_get send failed', err)
				void debugLog('federation', { scope: 'fed_chunk_get', peerId: targetPeerId, message: err?.message })
					.catch(error => console.warn('federation: fed_chunk_get debugLog failed', error))
			}
	})
}

/**
 * @param {object} slot 联邦槽
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} chunkHash 块哈希
 * @returns {Promise<Uint8Array>} 密文块
 */
function fetchChunkFromRoster(slot, username, groupId, chunkHash) {
	const roster = slot.getRoster()
	if (!roster.length) throw new Error('no federation peers for chunk fetch')
	const peerIds = roster.map(p => p.peerId).filter(Boolean)
	const preferred = assignChunksToPeers([chunkHash], peerIds).get(chunkHash) || null
	return fetchChunkFromPeer(slot, username, groupId, chunkHash, preferred)
}

/**
 * 并发拉取多个缺失分块（按 peer 轮转分配，失败块广播重试）。
 * @param {object} slot 联邦槽
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string[]} chunkHashes 缺失块
 * @param {{ concurrency?: number, maxAttempts?: number }} [opts] 选项
 * @returns {Promise<{ fetched: Record<string, Uint8Array>, missing: string[] }>} 结果
 */
export async function fetchChunksFromRoster(slot, username, groupId, chunkHashes, opts = {}) {
	const roster = slot.getRoster()
	const peerIds = roster.map(p => p.peerId).filter(Boolean)
	if (!peerIds.length) throw new Error('no federation peers for chunk fetch')
	const concurrency = Math.max(1, Math.min(16, Number(opts.concurrency) || DEFAULT_FETCH_CONCURRENCY))
	/** @type {Map<string, { state: string, attempts: number }>} */
	const table = new Map(chunkHashes.map(h => [h, { state: 'pending', attempts: 0 }]))
	/** @type {Record<string, Uint8Array>} */
	const fetched = {}
	/** @type {string[]} */
	let missing = [...chunkHashes]

	while (missing.length) {
		const plan = planChunkFetches(table, missing, peerIds, { maxAttempts: opts.maxAttempts ?? 3 })
		const batch = [...plan.assignments.entries()].slice(0, concurrency)
		if (!batch.length && plan.broadcast.length) 
			await Promise.all(plan.broadcast.map(hash =>
				fetchChunkFromPeer(slot, username, groupId, hash, null)
					.then(bytes => { fetched[hash] = bytes; markChunkDone(table, hash) })
					.catch(() => markChunkFailed(table, hash)),
			))
		
		else if (!batch.length) break

		await Promise.all(batch.map(async ([hash, peerId]) => {
			markChunkInflight(table, hash, peerId)
			try {
				const bytes = await fetchChunkFromPeer(slot, username, groupId, hash, peerId)
				fetched[hash] = bytes
				markChunkDone(table, hash)
			}
			catch {
				markChunkFailed(table, hash)
			}
		}))

		missing = missing.filter(h => !fetched[h])
		const allFailed = missing.every(h => table.get(h)?.state === 'failed')
		if (allFailed && plan.broadcast.length)
			await Promise.all(missing.map(async hash => {
				try {
					const bytes = await fetchChunkFromPeer(slot, username, groupId, hash, null)
					fetched[hash] = bytes
					markChunkDone(table, hash)
				}
				catch { /* keep missing */ }
			}))
		missing = missing.filter(h => !fetched[h])
		if (!batch.length) break
	}

	return { fetched, missing }
}

/**
 * 注册 Trystero `fed_chunk_*` 处理器，并向 slot 挂载复制/拉取 API。
 * @param {{
 *   username: string,
 *   groupId: string,
 *   room: object,
 *   peerToNode: Map<string, string>,
 *   isBlockedPeer: (id: string) => boolean,
 *   slot: object,
 *   fedOut?: { enqueue: (prio: number, fn: () => void) => void },
 * }} fedRoom 联邦房间上下文
 * @returns {object} 扩展后的 slot（含 chunk API）
 */
export function attachFedChunkHandlers(fedRoom) {
	const {
		username,
		groupId,
		room,
		peerToNode,
		isBlockedPeer,
		slot,
		fedOut,
		roomKey = '',
		rtcLimits = {},
	} = fedRoom
	const chunkBucketKey = registryKey(username, groupId)
	const local = localPlugin(username)

	const [sendChunkData, getChunkData] = room.makeAction('fed_chunk_data')
	const [, getChunkGet] = room.makeAction('fed_chunk_get')
	const [, getChunkPut] = room.makeAction('fed_chunk_put')
	const [sendChunkAck, getChunkAck] = room.makeAction('fed_chunk_ack')

	getChunkAck((data, peerId) => {
		if (!isPlainObject(data)) return
		const hash = String(data.chunkHash || '').trim().toLowerCase()
		if (!CHUNK_HASH_RE.test(hash)) return
		const remoteNode = peerToNode.get(peerId) || peerId
		recordChunkReplicationAck(username, groupId, hash, remoteNode)
	})

	getChunkPut((data, peerId) => {
		if (!isFederationActionAllowedUnderLoad(roomKey, 'fed_chunk_put', rtcLimits)) return
		void (async () => {
			if (!isPlainObject(data)) return
			const remoteNode = peerToNode.get(peerId)
			if (remoteNode && isBlockedPeer(remoteNode)) return
			const hash = String(data.chunkHash || '').trim().toLowerCase()
			if (!CHUNK_HASH_RE.test(hash)) return
			const b64 = String(data.dataB64 || '')
			if (!b64) return
			const bytes = b64ToU8(b64)
			if (bytes.byteLength > FEDERATION_CHUNK_MAX_BYTES) return
			if (!consumeChunkRate(chunkBucketKey, bytes.byteLength)) return
			const { storageLocator } = await local.putChunk(groupId, hash, bytes)
			await bumpChunkLocalRef(username, groupId, storageLocator)
			if (remoteNode)
				await bumpChunkStorageReputation(username, groupId, remoteNode)
			try {
				sendChunkAck({ chunkHash: hash }, peerId)
				sendChunkData({ chunkHash: hash, dataB64: u8ToB64(bytes) }, peerId)
			}
			catch (error) {
				console.warn('federation: fed_chunk_put response failed', error)
			}
		})().catch(error => console.warn('federation: fed_chunk_put handler failed', error))
	})

	getChunkGet((data, peerId) => {
		if (!isFederationActionAllowedUnderLoad(roomKey, 'fed_chunk_get', rtcLimits)) return
		void (async () => {
			if (!isPlainObject(data)) return
			const remoteNode = peerToNode.get(peerId)
			if (remoteNode && isBlockedPeer(remoteNode)) return
			const hash = String(data.chunkHash || '').trim().toLowerCase()
			if (!CHUNK_HASH_RE.test(hash)) return
			const requestId = String(data.requestId || '')
			if (requestId) {
				await handleIncomingChunkGet(username, data, (resp, pid) => {
					try {
						sendChunkData(resp, pid)
					}
					catch (error) {
						console.warn('federation: fed_chunk_get response failed', error)
					}
				}, peerId)
				return
			}
			const loc = `local:${groupId}/chunks/${hash}.bin`
			let bytes
			if (await hasChunk(username, hash))
				bytes = await getChunk(username, hash)
			else 
				try {
					bytes = await local.getChunk(loc)
				}
				catch {
					return
				}
			
			if (!bytes?.byteLength) return
			if (remoteNode)
				await bumpChunkStorageReputation(username, groupId, remoteNode)
			try {
				sendChunkData({ chunkHash: hash, dataB64: u8ToB64(bytes) }, peerId)
			}
			catch (error) {
				console.warn('federation: fed_chunk_get send data failed', error)
			}
		})().catch(error => console.warn('federation: fed_chunk_get handler failed', error))
	})

	getChunkData((data) => {
		if (!isPlainObject(data)) return
		const hash = String(data.chunkHash || '').trim().toLowerCase()
		if (!CHUNK_HASH_RE.test(hash)) return
		const b64 = String(data.dataB64 || '')
		if (!b64) return
		const waitKey = compositeKey(username, groupId, hash)
		const pending = pendingFetches.get(waitKey)
		if (!pending) return
		clearTimeout(pending.timer)
		pendingFetches.delete(waitKey)
		try {
			pending.resolve(b64ToU8(b64))
		}
		catch (error) {
			pending.reject(error instanceof Error ? error : new Error(String(error)))
		}
	})

	/**
	 * @param {string} chunkHash 块哈希
	 * @param {Uint8Array} data 密文
	 * @returns {Promise<void>}
	 */
	const replicate = (chunkHash, data) =>
		replicateChunkToRoster(slot, chunkHash, data, chunkBucketKey, { fedOut })
	/**
	 * @param {string} chunkHash 块哈希
	 * @returns {Promise<Uint8Array>} 密文块
	 */
	const fetch = chunkHash => fetchChunkFromRoster(slot, username, groupId, chunkHash)
	const api = { replicate, fetch }
	registerChunkSwarm(username, groupId, api)
	slot.replicateChunk = api.replicate
	slot.fetchChunk = api.fetch
	return slot
}

/**
 * TrustGraph 全局 chunk miss：sync 分区处理带 requestId 的 fed_chunk_get/data。
 * @param {string} username 用户
 * @param {object} room Trystero room
 * @param {{ enqueue: (prio: number, fn: () => void) => void }} fedOut 出站队列
 * @param {object} [rtcLimits] RTC 限额
 * @param {string} [roomKey] 房间键
 * @returns {void}
 */
export function attachTrustGraphChunkHandlers(username, room, fedOut, rtcLimits = {}, roomKey = '') {
	const [sendChunkData, getChunkData] = room.makeAction('fed_chunk_data')
	const [, getChunkGet] = room.makeAction('fed_chunk_get')

	getChunkGet((data, peerId) => {
		if (!isFederationActionAllowedUnderLoad(roomKey, 'fed_chunk_get', rtcLimits)) return
		void (async () => {
			if (!isPlainObject(data)) return
			const requestId = String(data.requestId || '')
			if (!requestId) return
			await handleIncomingChunkGet(username, data, (resp, pid) => {
				fedOut.enqueue(6, () => {
					try {
						sendChunkData(resp, pid)
					}
					catch (error) {
						console.warn('federation: trust-graph chunk response failed', error)
					}
				})
			}, peerId)
		})().catch(error => console.warn('federation: trust-graph chunk handler failed', error))
	})

	getChunkData(data => {
		if (!isPlainObject(data) || !data.requestId) return
		resolvePendingChunkFetch(data)
	})
}
