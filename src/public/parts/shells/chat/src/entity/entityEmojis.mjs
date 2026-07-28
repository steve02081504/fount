/**
 * 实体作者表情包：`entities/{hash}/emoji_packs/{packId}/`。
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'

import { prefixedRandomId } from 'npm:@steve02081504/fount-p2p/core/random_id'

import { getAllUserNames } from '../../../../../../server/auth/index.mjs'
import {
	entityEmojiPacksRoot,
	userEntitiesRoot,
} from '../chat/lib/paths.mjs'
import * as store from '../emojiPacks/packStore.mjs'

/** 复用 packStore.packSummary。 */
export { packSummary } from '../emojiPacks/packStore.mjs'

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
 * @returns {{ replicaUsername: string, authorEntityHash: string } | null} 托管位置
 */
export function findEntityPackHost(packId) {
	const pid = String(packId || '').trim()
	if (!pid) return null
	for (const replicaUsername of getAllUserNames()) {
		const entitiesRoot = userEntitiesRoot(replicaUsername)
		if (!fs.existsSync(entitiesRoot)) continue
		for (const authorEntityHash of fs.readdirSync(entitiesRoot)) {
			const manifestPath = store.packManifestPath(packsRoot(replicaUsername, authorEntityHash), pid)
			if (fs.existsSync(manifestPath))
				return { replicaUsername, authorEntityHash }
		}
	}
	return null
}

/**
 * @param {string} packId pack id
 * @returns {Promise<{ replicaUsername: string, authorEntityHash: string, manifest: object } | null>} 定位结果
 */
export async function findPackAcrossEntities(packId) {
	const host = findEntityPackHost(packId)
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
	const packId = String(fields.packId || '').trim() || prefixedRandomId('epack_')
	return store.createPack(
		packsRoot(replicaUsername, authorEntityHash),
		entitySource(authorEntityHash),
		{ ...fields, packId },
	)
}

/**
 * @param {string} replicaUsername replica
 * @param {string} authorEntityHash 作者 entityHash
 * @param {string} packId pack id
 * @param {{ localized?: object }} patch 更新
 * @returns {Promise<object>} manifest
 */
export async function updateEntityPack(replicaUsername, authorEntityHash, packId, patch = {}) {
	return store.updatePack(
		packsRoot(replicaUsername, authorEntityHash),
		entitySource(authorEntityHash),
		packId,
		patch,
	)
}

/**
 * @param {string} replicaUsername replica
 * @param {string} authorEntityHash 作者 entityHash
 * @param {string} packId pack id
 * @returns {Promise<boolean>} 是否删除
 */
export async function deleteEntityPack(replicaUsername, authorEntityHash, packId) {
	return store.deletePack(packsRoot(replicaUsername, authorEntityHash), packId)
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
