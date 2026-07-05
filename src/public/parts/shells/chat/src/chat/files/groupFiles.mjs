/**
 * 【文件】files/groupFiles.mjs
 * 【职责】群文件分块加解密、上传/下载、联邦复制与 DAG file_upload/delete 编排（§10）。
 * 【原理】GSH 收敛加密 + wrapContentKey；blobStore 本地密文缓存；replicateChunkToFederation；权限查 UPLOAD_FILES。
 * 【数据结构】uploadMeta、parts[]、storageLocator blob:/federation:；fileMetaFromState 物化索引。
 * 【关联】blobStore、chunkReplicationAck、reputation、dag/channelOps、federation/chunks。
 */
import { Buffer } from 'node:buffer'

import { debugLog } from '../../../../../../../scripts/debug_log.mjs'
import { b64ToU8 } from '../../../../../../../scripts/p2p/bytes_codec.mjs'
import { saveFileManifest, storeManifestParts } from '../../../../../../../scripts/p2p/entity/files/evfs.mjs'
import { groupEntityHash } from '../../../../../../../scripts/p2p/entity/group_entity.mjs'
import { getChunk, hasChunk, putChunk } from '../../../../../../../scripts/p2p/files/chunk_store.mjs'
import { normalizeFileManifest } from '../../../../../../../scripts/p2p/files/manifest.mjs'
import { BLOB_STORAGE_LOCATOR_RE, isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import {
	decryptConvergentCiphertext,
	decryptRandomCiphertext,
	deriveContentKey,
	encryptConvergentPlaintext,
	encryptRandomPlaintext,
	unwrapContentKey,
	wrapContentKey,
} from '../../../../../../../scripts/p2p/key_crypto.mjs'
import { penalizeChunkStorageFailure } from '../../../../../../../scripts/p2p/reputation_store.mjs'
import { createLocalStoragePlugin } from '../../../../../../../scripts/p2p/storage_plugins.mjs'
import { getState } from '../dag/materialize.mjs'
import {
	fetchChunksFromRoster,
	fetchCiphertextFromFederation,
	replicateChunkToFederation,
} from '../federation/chunks.mjs'
import { ensureFederationRoom } from '../federation/room.mjs'
import { getCurrentFileMasterKey, getFileMasterKeyByGeneration } from '../file_keys/store.mjs'
import { updateGroupEntityIndex } from '../groupEntityIndex.mjs'
import { shellChatRoot } from '../lib/paths.mjs'
import { getFederatedChunkStorage, getStorageForGroup } from '../storage.mjs'

import {
	bumpCiphertextBlobRef,
	cachePlaintextFile,
	getCiphertextBlob,
	getPlaintextCache,
	hasCiphertextBlob,
	putCiphertextBlob,
	releaseCiphertextBlob,
} from './blobStore.mjs'
import {
	ensureDownloadTask,
	saveDownloadTask,
	updateDownloadChunkState,
} from './downloadTasks.mjs'

/**
 * @param {object} state 物化群状态
 * @param {string} [channelId] 目标频道；缺省为群默认频道
 * @returns {string} 用于 `UPLOAD_FILES` 权限检查的频道 ID
 */
export function uploadPermissionChannelId(state, channelId) {
	const trimmed = String(channelId || '').trim()
	if (trimmed && state.channels?.[trimmed]) return trimmed
	return state.groupSettings?.defaultChannelId || 'default'
}

/**
 * @param {string} locator 存储定位符
 * @returns {boolean} 是否为 `blob:{ciphertextHash}`
 */
function isBlobLocator(locator) {
	return BLOB_STORAGE_LOCATOR_RE.test(String(locator || '').trim())
}

/**
 * 解析上传用 fileId 与分块明文。
 * @param {{ fileId?: string, data?: string }} body 请求体
 * @returns {{ fileId: string, data: Uint8Array }} fileId 与明文
 */
export function parseChunkBody(body) {
	const fileId = body.fileId?.trim()
	if (!fileId) throw new Error('fileId required')
	if (!body.data?.trim()) throw new Error('data (base64) required')
	return { fileId, data: b64ToU8(body.data) }
}

/**
 * @param {unknown} value 传入模式
 * @returns {'convergent'|'random'} 规范模式
 */
export function normalizeCeMode(value) {
	return String(value || '').trim().toLowerCase() === 'random' ? 'random' : 'convergent'
}

/**
 * 从 `blob:` 定位符或裸 hex 解析密文哈希。
 * @param {string} storageLocator 存储定位符
 * @returns {string | null} 小写 hex 或 null
 */
function ciphertextHashFromLocator(storageLocator) {
	const m = String(storageLocator || '').match(BLOB_STORAGE_LOCATOR_RE)
	return m ? m[1].toLowerCase() : null
}

/**
 * 将密文写入群分块目录与可选 S3/P2P 插件（与 `blobs/` 收敛库并行，§10.2）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} ciphertextHash 密文哈希
 * @param {Uint8Array} raw 密文
 * @param {object} [groupSettings] 群设置
 * @returns {Promise<void>}
 */
async function mirrorCiphertextToStorageBackends(username, groupId, ciphertextHash, raw, groupSettings = {}) {
	const hash = String(ciphertextHash || '').trim().toLowerCase()
	const local = createLocalStoragePlugin(shellChatRoot(username))
	await local.putChunk(groupId, hash, raw).catch(() => { })
	await putChunk( hash, raw).catch(() => { })

	const storage = getStorageForGroup(username, groupSettings, { groupId })
	const peerId = storage.storagePeerId
	if (peerId === 's3' || peerId === 'federated')
		await storage.putChunk(groupId, hash, raw).catch(() => { })

	const fed = getFederatedChunkStorage(username, groupSettings)
	if (fed && peerId !== 'federated')
		await fed.putChunk(groupId, hash, raw).catch(() => { })
}

/**
 * 按 blob → 本地分块 → P2P 邻居 → 联邦 S3 顺序解析密文（§10.2/10.3）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} storageLocator `blob:{hash}`
 * @returns {Promise<Buffer>} 密文
 */
async function resolveCiphertextRaw(username, groupId, storageLocator) {
	const hash = ciphertextHashFromLocator(storageLocator)
	if (!hash) throw new Error('invalid blob locator')

	try {
		return await getCiphertextBlob(username, storageLocator)
	}
	catch { /* fall through */ }

	if (await hasChunk( hash))
		return Buffer.from(await getChunk( hash))

	const local = createLocalStoragePlugin(shellChatRoot(username))
	const localLoc = `local:${groupId}/chunks/${hash}.bin`
	try {
		const u8 = await local.getChunk(localLoc)
		await putCiphertextBlob(username, hash, u8).catch(() => { })
		return Buffer.from(u8)
	}
	catch { /* fall through */ }

	let groupSettings = {}
	try {
		const { state } = await getState(username, groupId)
		groupSettings = state?.groupSettings || {}
	}
	catch { /* noop */ }

	try {
		const u8 = await fetchCiphertextFromFederation(username, groupId, hash)
		await putCiphertextBlob(username, hash, u8).catch(() => { })
		await mirrorCiphertextToStorageBackends(username, groupId, hash, u8, groupSettings).catch(() => { })
		return Buffer.from(u8)
	}
	catch (error) {
		await debugLog('group-files-fed-fetch', { username, groupId, hash, message: error?.message }).catch(() => { })
	}

	const fed = getFederatedChunkStorage(username, groupSettings)
	if (fed) {
		const fedLoc = `fed:groups/${groupId}/chunks/${hash}.bin`
		const u8 = await fed.getChunk(fedLoc)
		await putCiphertextBlob(username, hash, u8).catch(() => { })
		await local.putChunk(groupId, hash, u8).catch(() => { })
		return Buffer.from(u8)
	}

	throw new Error('ciphertext blob not found locally or via federation')
}

/**
 * 校验单块 manifest 字段。
 * @param {object} part 分块描述
 * @returns {void}
 */
function assertFilePartManifest(part) {
	for (const key of ['contentHash', 'ciphertextHash', 'wrappedKey', 'storageLocator'])
		if (!part[key]) throw new Error(`part ${key} required`)
	const ceMode = normalizeCeMode(part.ceMode)
	if (!['convergent', 'random'].includes(ceMode))
		throw new Error('invalid part ceMode')
	if (!isBlobLocator(part.storageLocator)) throw new Error('part storageLocator must be blob:{hash}')
	if (!isHex64(String(part.contentHash).trim().toLowerCase()))
		throw new Error('invalid part contentHash')
	if (!isHex64(String(part.ciphertextHash).trim().toLowerCase()))
		throw new Error('invalid part ciphertextHash')
}

/**
 * 校验 `file_upload` DAG 必填字段（单块或 `parts[]` 多块）。
 * @param {object} body 请求体
 * @returns {void}
 */
export function assertFileUploadBody(body) {
	const ceMode = normalizeCeMode(body.ceMode)
	if (!['convergent', 'random'].includes(ceMode))
		throw new Error('invalid ceMode')
	if (Array.isArray(body.parts) && body.parts.length) {
		if (!isHex64(String(body.contentHash || '').trim().toLowerCase()))
			throw new Error('invalid contentHash')
		for (const part of body.parts) assertFilePartManifest(part)
		return
	}
	for (const key of ['contentHash', 'ciphertextHash', 'wrappedKey', 'storageLocator'])
		if (!body[key]) throw new Error(`${key} required`)

	if (!isBlobLocator(body.storageLocator)) throw new Error('storageLocator must be blob:{hash}')
	if (!isHex64(String(body.contentHash).trim().toLowerCase()))
		throw new Error('invalid contentHash')
	if (!isHex64(String(body.ciphertextHash).trim().toLowerCase()))
		throw new Error('invalid ciphertextHash')
}

/**
 * 上传收敛密文块（§10.3）：同明文跨群复用 `blobs/{ciphertextHash}`。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {{ fileId: string, data: Uint8Array, keyGeneration?: number, channelId?: string, ceMode?: string }} opts 明文与可选代数
 * @returns {Promise<object>} manifest 字段（contentHash、ciphertextHash、wrappedKey 等）
 */
export async function putEncryptedChunk(username, groupId, opts) {
	const keyEntry = await getCurrentFileMasterKey(username, groupId)
	if (!keyEntry) throw new Error('group file master key not initialized')

	const ceMode = normalizeCeMode(opts.ceMode)
	const encrypted = ceMode === 'random'
		? encryptRandomPlaintext(opts.data)
		: encryptConvergentPlaintext(opts.data)
	const { contentHash, ciphertextHash, raw } = encrypted
	const have = await hasCiphertextBlob(username, ciphertextHash)
	const storageLocator = have
		? await bumpCiphertextBlobRef(username, ciphertextHash)
		: await putCiphertextBlob(username, ciphertextHash, raw)
	await putChunk( ciphertextHash, raw).catch(() => { })

	let groupSettings = {}
	try {
		const { state } = await getState(username, groupId)
		groupSettings = state?.groupSettings || {}
	}
	catch { /* noop */ }

	if (!have) {
		await mirrorCiphertextToStorageBackends(username, groupId, ciphertextHash, raw, groupSettings)
		const storage = getStorageForGroup(username, groupSettings, { groupId })
		const M = Number(groupSettings.fileReplicationFactor)
		const requiredAcks = Number.isFinite(M) && M > 0 ? Math.floor(M) : 0
		const wantFed = storage.storagePeerId === 'federation_swarm' || requiredAcks > 0
		if (wantFed) {
			await ensureFederationRoom(username, groupId, {
				channelId: String(opts.channelId || '').trim() || undefined,
			}).catch(() => { })
			await replicateChunkToFederation(username, groupId, ciphertextHash, raw, {
				requiredAcks: storage.storagePeerId === 'federation_swarm' ? requiredAcks : 0,
				timeoutMs: 5500,
			})
		}
	}

	const contentKey = ceMode === 'random'
		? encrypted.contentKey
		: deriveContentKey(contentHash)
	const wrappedKey = wrapContentKey(contentKey, keyEntry.fileMasterKey, opts.fileId)
	await cachePlaintextFile(username, contentHash, opts.data)

	return {
		ceMode,
		contentHash,
		ciphertextHash,
		storageLocator,
		wrappedKey,
		key_generation: opts.keyGeneration ?? keyEntry.generation,
		have,
	}
}

/**
 * 密文块已存在时仅登记 wrappedKey 与引用（§10.3 预检 have-it，跳过重复上传）。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {{ fileId: string, data: Uint8Array, keyGeneration?: number, ceMode?: string }} opts 明文（用于推导 content/ciphertext 哈希）
 * @returns {Promise<object | null>} manifest；本地无密文时 `null`
 */
export async function registerEncryptedChunkIfPresent(username, groupId, opts) {
	const keyEntry = await getCurrentFileMasterKey(username, groupId)
	if (!keyEntry) throw new Error('group file master key not initialized')

	const ceMode = normalizeCeMode(opts.ceMode)
	const encrypted = ceMode === 'random'
		? encryptRandomPlaintext(opts.data)
		: encryptConvergentPlaintext(opts.data)
	const { contentHash, ciphertextHash } = encrypted
	const have = await hasCiphertextBlob(username, ciphertextHash)
	if (!have) return null

	const storageLocator = await bumpCiphertextBlobRef(username, ciphertextHash)
	const contentKey = ceMode === 'random'
		? encrypted.contentKey
		: deriveContentKey(contentHash)
	const wrappedKey = wrapContentKey(contentKey, keyEntry.fileMasterKey, opts.fileId)
	await cachePlaintextFile(username, contentHash, opts.data)

	return {
		ceMode,
		contentHash,
		ciphertextHash,
		storageLocator,
		wrappedKey,
		key_generation: opts.keyGeneration ?? keyEntry.generation,
		have: true,
	}
}

/**
 * 按 manifest 解密整文件（单块或 `parts[]` 拼接，§10.3）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} meta 文件元数据
 * @param {string} [blamePeerKey] 解密失败时扣信誉的责任方
 * @returns {Promise<Uint8Array>} 明文
 */
export async function getDecryptedFile(username, groupId, meta, blamePeerKey) {
	const parts = Array.isArray(meta?.parts) ? meta.parts : null
	if (parts?.length) {
		const sorted = [...parts].sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
		const fileId = String(meta?.fileId || '').trim()
		const chunkHashes = sorted
			.map(part => String(part?.ciphertextHash || '').trim().toLowerCase())
			.filter(isHex64)
		if (fileId && chunkHashes.length)
			await ensureDownloadTask(username, groupId, fileId, chunkHashes, {
				contentHash: String(meta?.contentHash || '').trim().toLowerCase(),
				totalSize: Number(meta?.size) || 0,
			}).catch(() => { })

		const missingHashes = []
		for (const hash of chunkHashes)
			if (!await hasCiphertextBlob(username, hash)) missingHashes.push(hash)

		if (missingHashes.length) {
			const slot = await ensureFederationRoom(username, groupId, { channelId: meta?.channelId })
			if (!slot) throw new Error('federation unavailable for chunk download')
			for (const hash of missingHashes)
				if (fileId) await updateDownloadChunkState(username, groupId, fileId, hash, 'inflight').catch(() => { })
			const { fetched, missing } = await fetchChunksFromRoster(slot, username, groupId, missingHashes, {
				concurrency: 8,
				maxAttempts: 3,
			})
			for (const [hash, bytes] of Object.entries(fetched))
				await putCiphertextBlob(username, hash, bytes).catch(() => { })
			for (const [hash, bytes] of Object.entries(fetched))
				void replicateChunkToFederation(username, groupId, hash, bytes, { requiredAcks: 0 }).catch(() => { })
			for (const hash of Object.keys(fetched))
				if (fileId) await updateDownloadChunkState(username, groupId, fileId, hash, 'done').catch(() => { })
			for (const hash of missing)
				if (fileId) await updateDownloadChunkState(username, groupId, fileId, hash, 'failed').catch(() => { })
			if (missing.length) {
				if (fileId) {
					const task = await ensureDownloadTask(username, groupId, fileId, chunkHashes)
					await saveDownloadTask(username, groupId, {
						...task,
						status: task?.status === 'unrecoverable' ? 'unrecoverable' : 'failed',
					})
				}
				throw new Error(`chunk download incomplete: ${missing.length} missing`)
			}
		}
		if (fileId) {
			const task = await ensureDownloadTask(username, groupId, fileId, chunkHashes)
			await saveDownloadTask(username, groupId, {
				...task,
				status: 'done',
				seededAt: Date.now(),
			}).catch(() => { })
		}

		const slices = []
		for (const part of sorted) {
			const chunkHash = String(part?.ciphertextHash || '').trim().toLowerCase()
			try {
				slices.push(await getDecryptedChunk(
					username,
					groupId,
					part.storageLocator,
					part.contentHash,
					{
						ceMode: part.ceMode || meta.ceMode || 'convergent',
						wrappedKey: part.wrappedKey || null,
						keyGeneration: part.key_generation ?? meta.key_generation ?? null,
						fileId,
					},
					blamePeerKey,
				))
				if (fileId && isHex64(chunkHash))
					await updateDownloadChunkState(username, groupId, fileId, chunkHash, 'done').catch(() => { })
			}
			catch (error) {
				if (fileId && isHex64(chunkHash))
					await updateDownloadChunkState(username, groupId, fileId, chunkHash, 'failed').catch(() => { })
				throw error
			}
		}
		const total = Number(meta.size) || slices.reduce((n, u8) => n + u8.byteLength, 0)
		const out = new Uint8Array(total)
		let off = 0
		for (const u8 of slices) {
			out.set(u8, off)
			off += u8.byteLength
		}
		return out
	}
	if (!meta?.storageLocator || !meta?.contentHash)
		throw new Error('file metadata incomplete')
	// 单块文件也维护下载任务，使 download-status 能反映真实完成状态（本地命中或经联邦拉取后标记 done）。
	const fileId = String(meta?.fileId || '').trim()
	const chunkHash = String(meta?.ciphertextHash || '').trim().toLowerCase()
	const singleHash = isHex64(chunkHash) ? chunkHash : ciphertextHashFromLocator(meta.storageLocator)
	if (fileId && singleHash)
		await ensureDownloadTask(username, groupId, fileId, [singleHash], {
			contentHash: String(meta?.contentHash || '').trim().toLowerCase(),
			totalSize: Number(meta?.size) || 0,
		}).catch(() => { })
	try {
		if (fileId && singleHash)
			await updateDownloadChunkState(username, groupId, fileId, singleHash, 'inflight').catch(() => { })
		const plain = await getDecryptedChunk(
			username,
			groupId,
			meta.storageLocator,
			meta.contentHash,
			{
				ceMode: meta.ceMode || 'convergent',
				wrappedKey: meta.wrappedKey || null,
				keyGeneration: meta.key_generation ?? null,
				fileId,
			},
			blamePeerKey,
		)
		if (fileId && singleHash)
			await updateDownloadChunkState(username, groupId, fileId, singleHash, 'done').catch(() => { })
		return plain
	}
	catch (error) {
		if (fileId && singleHash)
			await updateDownloadChunkState(username, groupId, fileId, singleHash, 'failed').catch(() => { })
		throw error
	}
}

/**
 * 读取 `blob:` 密文并解密为明文。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} storageLocator `blob:{ciphertextHash}`
 * @param {string} contentHashHex 明文 SHA-256
 * @param {{ ceMode?: string, wrappedKey?: { iv: string, ciphertext: string, authTag: string } | null, keyGeneration?: number | null, fileId?: string }} [options] 解密选项
 * @param {string} [blamePeerKey] 解密失败时扣信誉的责任方
 * @returns {Promise<Uint8Array>} 明文
 */
export async function getDecryptedChunk(username, groupId, storageLocator, contentHashHex, options = {}, blamePeerKey) {
	const contentHash = String(contentHashHex || '').trim().toLowerCase()
	const ceMode = normalizeCeMode(options?.ceMode)
	if (!isBlobLocator(storageLocator)) throw new Error('locator must be blob:{hash}')
	if (!isHex64(contentHash)) throw new Error('content_hash required')

	const cached = await getPlaintextCache(username, contentHash)
	if (cached) return new Uint8Array(cached)

	let raw
	try {
		raw = await resolveCiphertextRaw(username, groupId, storageLocator)
	}
	catch (e) {
		if (blamePeerKey) void penalizeChunkStorageFailure(blamePeerKey).catch(() => { })
		throw e
	}
	let plain = null
	if (ceMode === 'random') {
		if (!options?.wrappedKey) throw new Error('wrappedKey required for random ceMode')
		const fileId = String(options?.fileId || '').trim()
		if (!fileId) throw new Error('fileId required for random ceMode')
		const keyGeneration = Number.isFinite(Number(options?.keyGeneration))
			? Math.floor(Number(options.keyGeneration))
			: null
		const keyEntry = keyGeneration == null
			? await getCurrentFileMasterKey(username, groupId)
			: { fileMasterKey: await getFileMasterKeyByGeneration(username, groupId, keyGeneration), generation: keyGeneration }
		if (!keyEntry?.fileMasterKey) throw new Error('missing file master key for random ceMode')
		const contentKey = unwrapContentKey(options.wrappedKey, keyEntry.fileMasterKey, fileId)
		if (!contentKey) throw new Error('unwrap random content key failed')
		plain = decryptRandomCiphertext(raw, contentKey, contentHash)
	}
	else
		plain = decryptConvergentCiphertext(raw, contentHash)
	if (!plain) {
		if (blamePeerKey) void penalizeChunkStorageFailure(blamePeerKey).catch(() => { })
		throw new Error('convergent blob decrypt failed')
	}
	void cachePlaintextFile(username, contentHash, plain).catch(() => { })
	return new Uint8Array(plain)
}

/**
 * 从物化状态 fileIndex 取文件元数据。
 * @param {object} state 群状态
 * @param {string} fileId 文件 ID
 * @returns {object | null} 索引项
 */
export function fileMetaFromState(state, fileId) {
	const fileIndex = state.messageOverlay?.fileIndex
	if (!fileIndex) return null
	if (fileIndex instanceof Map) return fileIndex.get(fileId) || null
	return fileIndex[fileId] || null
}

/**
 * 物化 fileIndex 中未逻辑删除的文件列表（供 Hub 文件侧栏）。
 * @param {object} state 群物化状态
 * @returns {Array<{ fileId: string, name?: string, size?: number, mimeType?: string, folderId?: string | null }>} 文件摘要
 */
export function listActiveFilesFromState(state) {
	const fileIndex = state.messageOverlay?.fileIndex
	if (!fileIndex) return []
	const rows = []
	/**
	 * @param {string} fileId DAG 文件 ID
	 * @param {object} meta `fileIndex` 条目（含 `deleted`、`name`、`size` 等）
	 * @returns {void}
	 */
	const push = (fileId, meta) => {
		if (!meta || meta.deleted) return
		rows.push({
			fileId,
			name: meta.name || fileId,
			size: meta.size ?? null,
			mimeType: meta.mimeType || null,
			folderId: meta.folderId ?? null,
		})
	}
	if (fileIndex instanceof Map)
		for (const [fileId, meta] of fileIndex) push(fileId, meta)
	else
		for (const [fileId, meta] of Object.entries(fileIndex || {})) push(fileId, meta)

	return rows.sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

/**
 * `file_delete` 后释放 blob 引用（§10.4）。
 * @param {string} username 用户
 * @param {object} meta 文件元数据
 * @returns {Promise<{ released: number, deleted: number }>} 释放与物理删除计数
 */
export async function releaseFileStorageRefs(username, meta) {
	if (!meta) return { released: 0, deleted: 0 }
	let released = 0
	let deleted = 0

	const blobLocs = new Set()
	if (meta.storageLocator && isBlobLocator(meta.storageLocator)) blobLocs.add(meta.storageLocator.trim())
	if (meta.ciphertextHash) blobLocs.add(`blob:${String(meta.ciphertextHash).trim().toLowerCase()}`)

	for (const loc of blobLocs) {
		released++
		if (await releaseCiphertextBlob(username, loc)) deleted++
	}
	return { released, deleted }
}

/**
 * 将群 file_upload 元数据同步为 groupEntityHash EVFS manifest。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} uploadMeta DAG file_upload 摘要
 * @returns {Promise<object | null>} manifest
 */
export async function syncGroupFileManifest(username, groupId, uploadMeta) {
	const fileId = String(uploadMeta?.fileId || '').trim()
	if (!fileId) return null
	const ownerEntityHash = groupEntityHash(groupId)
	const logicalPath = `chat/${fileId}`
	const ceMode = normalizeCeMode(uploadMeta.ceMode)
	const keyGen = uploadMeta.key_generation

	/** @type {import('../../../../../../../scripts/p2p/files/manifest.mjs').FileManifest | null} */
	let manifest = null

	if (Array.isArray(uploadMeta.parts) && uploadMeta.parts.length) 
		manifest = normalizeFileManifest({
			ownerEntityHash,
			logicalPath,
			name: uploadMeta.name || fileId,
			mimeType: uploadMeta.mimeType || 'application/octet-stream',
			size: Number(uploadMeta.size) || 0,
			contentHash: uploadMeta.contentHash,
			ceMode,
			parts: uploadMeta.parts.map(part => ({
				hash: String(part.ciphertextHash || '').trim().toLowerCase(),
				size: Number(part.partSize) || 0,
			})),
			transferKeyDescriptor: {
				type: 'file-master-key-wrap',
				groupId,
				fileId,
				keyGeneration: keyGen,
				wrappedKey: uploadMeta.parts[0]?.wrappedKey,
			},
			meta: { groupId, fileId, dagParts: uploadMeta.parts },
		})
	
	else if (uploadMeta.ciphertextHash) 
		manifest = normalizeFileManifest({
			ownerEntityHash,
			logicalPath,
			name: uploadMeta.name || fileId,
			mimeType: uploadMeta.mimeType || 'application/octet-stream',
			size: Number(uploadMeta.size) || 0,
			contentHash: uploadMeta.contentHash,
			ceMode,
			parts: [{ hash: uploadMeta.ciphertextHash, size: Number(uploadMeta.size) || 0 }],
			transferKeyDescriptor: {
				type: 'file-master-key-wrap',
				groupId,
				fileId,
				keyGeneration: keyGen,
				wrappedKey: uploadMeta.wrappedKey,
			},
			meta: { groupId, fileId },
		})
	
	if (!manifest) return null

	/** @type {Buffer[]} */
	const partBytes = []
	for (const part of manifest.parts) {
		if (await hasChunk( part.hash)) {
			partBytes.push(await getChunk( part.hash))
			continue
		}
		try {
			partBytes.push(await getCiphertextBlob(username, `blob:${part.hash}`))
		}
		catch { /* skip */ }
	}
	if (partBytes.length === manifest.parts.length)
		await storeManifestParts(manifest, partBytes)
	await saveFileManifest(manifest)
	await updateGroupEntityIndex(username, groupId)
	return manifest
}
