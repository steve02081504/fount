/**
 * 实体作者表情包：`entities/{hash}/emoji_packs/{packId}/`。
 */
import fsp from 'node:fs/promises'

import { prefixedRandomId } from 'npm:@steve02081504/fount-p2p/core/random_id'

import { createLruMap } from '../../../../../../scripts/memo.mjs'
import { getAllUserNames } from '../../../../../../server/auth/index.mjs'
import {
	entityEmojiPacksRoot,
	userEntitiesRoot,
} from '../chat/lib/paths.mjs'
import * as store from '../emojiPacks/packStore.mjs'

/** 复用 packStore.packSummary。 */
export { packSummary } from '../emojiPacks/packStore.mjs'

const PACK_HOST_CACHE_MAX = 256
/** @type {Map<string, { replicaUsername: string, authorEntityHash: string } | null> & { touch: Function }} */
const packHostCache = createLruMap(PACK_HOST_CACHE_MAX)

/**
 * @param {string} entityHash 作者 entityHash
 * @returns {{ kind: 'entity', id: string }} source
 */
function entitySource(entityHash) {
	return { kind: 'entity', id: entityHash }
}

/**
 * @param {string} replicaUsername replica
 * @param {string} entityHash 作者 entityHash
 * @returns {string} packs 根目录
 */
export function packsRoot(replicaUsername, entityHash) {
	return entityEmojiPacksRoot(replicaUsername, entityHash)
}

/**
 * @param {string} packId pack id
 * @returns {Promise<{ replicaUsername: string, authorEntityHash: string } | null>} 托管位置
 */
export async function findEntityPackHost(packId) {
	const pid = packId || ''
	if (!pid || !store.isSafePackId(pid)) return null
	if (packHostCache.has(pid)) {
		const hit = packHostCache.get(pid)
		packHostCache.touch(pid, hit)
		return hit
	}
	/** @type {{ replicaUsername: string, authorEntityHash: string } | null} */
	let found = null
	for (const replicaUsername of getAllUserNames()) {
		const entitiesRoot = userEntitiesRoot(replicaUsername)
		let authors
		try {
			authors = await fsp.readdir(entitiesRoot)
		}
		catch {
			continue
		}
		for (const authorEntityHash of authors) {
			const manifestPath = store.packManifestPath(packsRoot(replicaUsername, authorEntityHash), pid)
			try {
				await fsp.access(manifestPath)
				found = { replicaUsername, authorEntityHash }
				break
			}
			catch { /* miss */ }
		}
		if (found) break
	}
	packHostCache.touch(pid, found)
	return found
}

/**
 * @param {string} packId pack id
 * @returns {Promise<{ replicaUsername: string, authorEntityHash: string, manifest: object } | null>} 定位结果
 */
export async function findPackAcrossEntities(packId) {
	const host = await findEntityPackHost(packId)
	if (!host) return null
	const manifest = await store.loadPackManifest(
		packsRoot(host.replicaUsername, host.authorEntityHash),
		packId,
		entitySource(host.authorEntityHash),
	)
	if (!manifest) return null
	return { ...host, manifest }
}

/**
 * @param {string} replicaUsername replica
 * @param {string} authorEntityHash 作者 entityHash
 * @returns {Promise<object[]>} pack 列表
 */
export async function listEntityPacks(replicaUsername, authorEntityHash) {
	return store.listPacks(packsRoot(replicaUsername, authorEntityHash), entitySource(authorEntityHash))
}

/**
 * @param {string} replicaUsername replica
 * @param {string} authorEntityHash 作者 entityHash
 * @param {string} packId pack id
 * @returns {Promise<object | null>} manifest
 */
export async function loadEntityPackManifest(replicaUsername, authorEntityHash, packId) {
	return store.loadPackManifest(
		packsRoot(replicaUsername, authorEntityHash),
		packId,
		entitySource(authorEntityHash),
	)
}

/**
 * @param {string} replicaUsername replica
 * @param {string} authorEntityHash 作者 entityHash
 * @param {{ packId?: string, localized?: object }} [fields] 创建字段
 * @returns {Promise<object>} manifest
 */
export async function createEntityPack(replicaUsername, authorEntityHash, fields = {}) {
	const packId = (fields.packId || '') || prefixedRandomId('epack_')
	const manifest = await store.createPack(
		packsRoot(replicaUsername, authorEntityHash),
		entitySource(authorEntityHash),
		{ ...fields, packId },
	)
	packHostCache.touch(packId, { replicaUsername, authorEntityHash })
	return manifest
}

/**
 * @param {string} replicaUsername replica
 * @param {string} authorEntityHash 作者 entityHash
 * @param {string} packId pack id
 * @param {{ localized?: object }} patch 更新
 * @returns {Promise<object>} manifest
 */
export async function updateEntityPack(replicaUsername, authorEntityHash, packId, patch = {}) {
	const manifest = await store.updatePack(
		packsRoot(replicaUsername, authorEntityHash),
		entitySource(authorEntityHash),
		packId,
		patch,
	)
	packHostCache.delete(packId || '')
	return manifest
}

/**
 * @param {string} replicaUsername replica
 * @param {string} authorEntityHash 作者 entityHash
 * @param {string} packId pack id
 * @returns {Promise<boolean>} 是否删除
 */
export async function deleteEntityPack(replicaUsername, authorEntityHash, packId) {
	const ok = await store.deletePack(packsRoot(replicaUsername, authorEntityHash), packId)
	packHostCache.delete(packId || '')
	return ok
}

/**
 * @param {string} replicaUsername replica
 * @param {string} authorEntityHash 作者 entityHash
 * @returns {Promise<object>} 默认 pack
 */
export async function ensureDefaultEntityPack(replicaUsername, authorEntityHash) {
	const existing = await loadEntityPackManifest(replicaUsername, authorEntityHash, authorEntityHash)
	if (existing) return existing
	return createEntityPack(replicaUsername, authorEntityHash, { packId: authorEntityHash })
}

/**
 * @param {string} replicaUsername replica
 * @param {string} authorEntityHash 作者 entityHash
 * @param {string} packId pack id
 * @param {Buffer} buffer 图片
 * @param {string} originalname 文件名
 * @param {string} mimeType MIME
 * @param {string} [name] 显示名
 * @returns {Promise<object>} 新条目
 */
export async function uploadEntityPackEmoji(replicaUsername, authorEntityHash, packId, buffer, originalname, mimeType, name) {
	return store.uploadPackEmoji(
		packsRoot(replicaUsername, authorEntityHash),
		entitySource(authorEntityHash),
		packId,
		buffer,
		originalname,
		mimeType,
		name,
		replicaUsername,
	)
}

/**
 * @param {string} replicaUsername replica
 * @param {string} authorEntityHash 作者 entityHash
 * @param {string} packId pack id
 * @param {string} emojiId emoji id
 * @returns {Promise<boolean>} 是否删除
 */
export async function deleteEntityPackEmoji(replicaUsername, authorEntityHash, packId, emojiId) {
	return store.deletePackEmoji(
		packsRoot(replicaUsername, authorEntityHash),
		entitySource(authorEntityHash),
		packId,
		emojiId,
	)
}

/**
 * @param {string} replicaUsername replica
 * @param {string} authorEntityHash 作者 entityHash
 * @param {string} packId pack id
 * @param {string} emojiId emoji id
 * @returns {Promise<{ buffer: Buffer, mimeType: string, entry: object, packId: string } | null>} 二进制
 */
export async function readEntityPackEmojiBinary(replicaUsername, authorEntityHash, packId, emojiId) {
	return store.readPackEmojiBinary(
		packsRoot(replicaUsername, authorEntityHash),
		entitySource(authorEntityHash),
		packId,
		emojiId,
	)
}

/**
 * 本机可读的实体作者包（自有实体；关注可用性由 social 扩展）。
 * @param {string} username 用户名
 * @param {string} operatorEntityHash 当前 operator
 * @returns {Promise<object[]>} 可用 pack
 */
export async function listAvailableEntityPacksForUser(username, operatorEntityHash) {
	const entitiesRoot = userEntitiesRoot(username)
	try {
		await fsp.access(entitiesRoot)
	}
	catch {
		return []
	}
	/** @type {object[]} */
	const out = []
	for (const entityHash of await fsp.readdir(entitiesRoot)) {
		const packs = await listEntityPacks(username, entityHash)
		if (!packs.length) continue
		if (entityHash !== operatorEntityHash) continue
		for (const pack of packs)
			out.push({
				...pack,
				defaultEmojiPackId: entityHash,
				infoDefaults: { name: entityHash.slice(0, 8) },
			})
	}
	return out
}
