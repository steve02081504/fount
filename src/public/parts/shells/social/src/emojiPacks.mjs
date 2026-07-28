/**
 * Social 作者表情包：本地 entities/{hash}/emoji_packs/ + vault 二进制 + 时间线 manifest。
 */
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { prefixedRandomId } from 'npm:@steve02081504/fount-p2p/core/random_id'
import { putChunk } from 'npm:@steve02081504/fount-p2p/files/chunk_store'

import { loadJsonFile, saveJsonFile } from '../../../../../../scripts/json_loader.mjs'
import { entityEmojiPackDir, entityEmojiPacksRoot } from '../../../chat/src/chat/lib/paths.mjs'
import {
	convergeLinkedDefault,
	entityDefaultLinkKey,
} from '../../../chat/src/emojiUsage.mjs'
import { getProfile } from '../../../chat/src/entity/profile.mjs'

import { listFollowedTimelineOwners } from './following.mjs'
import { putVaultFileManifest } from './socialVaultIndex.mjs'
import { commitTimelineEvent } from './timeline/append.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'

const MAX_EMOJI_BYTES = 512 * 1024

/**
 * @param {string} filePath 路径
 * @returns {Promise<boolean>} 是否成功
 */
async function fileExists(filePath) {
	try {
		await fs.access(filePath)
		return true
	}
	catch {
		return false
	}
}

/**
 * @param {Buffer} buffer 字节
 * @returns {string} sha256 hex
 */
export function computeEmojiContentHash(buffer) {
	return createHash('sha256').update(buffer).digest('hex')
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {string} packId pack
 * @returns {string} manifest 路径
 */
function packManifestPath(username, entityHash, packId) {
	return path.join(entityEmojiPackDir(username, entityHash, packId), 'manifest.json')
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {string} [packId] id
 * @param {object} [localized] locale 切片
 * @returns {object} 空 manifest
 */
function emptyPackManifest(username, entityHash, packId, localized = {}) {
	void username
	const id = String(packId || '').trim() || prefixedRandomId('epack_')
	return {
		packId: id,
		source: { kind: 'entity', id: entityHash },
		localized: localized && typeof localized === 'object' ? localized : {},
		items: [],
		visibility: 'followers',
	}
}

/**
 * @param {object} manifest pack
 * @returns {object} 时间线事件 content
 */
function manifestEventContent(manifest) {
	return {
		packId: manifest.packId,
		source: manifest.source,
		localized: manifest.localized || {},
		items: (manifest.items || []).map(item => ({
			emojiId: item.emojiId,
			localized: item.localized || {},
			contentHash: item.contentHash || null,
			mimeType: item.mimeType || 'image/png',
			animated: !!item.animated,
			vaultFileId: item.vaultFileId || null,
			vaultPath: item.vaultPath || null,
		})),
		visibility: manifest.visibility || 'followers',
	}
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {object} manifest pack
 * @returns {Promise<void>} 无返回
 */
async function saveLocalManifest(username, entityHash, manifest) {
	const packId = String(manifest.packId || '').trim()
	const dir = entityEmojiPackDir(username, entityHash, packId)
	if (!await fileExists(dir)) await fs.mkdir(dir, { recursive: true })
	await saveJsonFile(packManifestPath(username, entityHash, packId), {
		packId,
		source: manifest.source || { kind: 'entity', id: entityHash },
		localized: manifest.localized || {},
		items: manifest.items || [],
		visibility: manifest.visibility || 'followers',
	})
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {string} packId pack
 * @returns {Promise<object | null>} pack 或 null
 */
export async function loadLocalEntityPack(username, entityHash, packId) {
	const pid = String(packId || '').trim()
	if (!pid) return null
	const p = packManifestPath(username, entityHash, pid)
	if (!await fileExists(p)) return null
	const raw = await loadJsonFile(p)
	if (!raw || typeof raw !== 'object') return null
	return {
		packId: String(raw.packId || pid),
		source: raw.source && typeof raw.source === 'object'
			? raw.source
			: { kind: 'entity', id: entityHash },
		localized: raw.localized && typeof raw.localized === 'object' ? raw.localized : {},
		items: Array.isArray(raw.items) ? raw.items : [],
		visibility: raw.visibility || 'followers',
	}
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @returns {Promise<object[]>} pack 列表
 */
export async function listLocalEntityPacks(username, entityHash) {
	const root = entityEmojiPacksRoot(username, entityHash)
	if (!await fileExists(root)) return []
	const ents = await fs.readdir(root, { withFileTypes: true })
	/** @type {object[]} */
	const out = []
	for (const ent of ents) {
		if (!ent.isDirectory()) continue
		const pack = await loadLocalEntityPack(username, entityHash, ent.name)
		if (pack) out.push(pack)
	}
	return out
}

/**
 * 从物化时间线取作者包（关注者侧）。
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @returns {Promise<object[]>} pack 列表
 */
export async function listTimelineEntityPacks(username, entityHash) {
	const view = await getTimelineMaterialized(username, entityHash)
	return Object.values(view.emojiPacks || {})
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {{ packId?: string, localized?: object }} [fields] 创建字段
 * @returns {Promise<object>} 结果
 */
export async function createEntityPack(username, entityHash, fields = {}) {
	const packId = String(fields.packId || '').trim() || prefixedRandomId('epack_')
	const existing = await loadLocalEntityPack(username, entityHash, packId)
	if (existing) throw new Error('pack already exists')
	const manifest = emptyPackManifest(username, entityHash, packId, fields.localized)
	await saveLocalManifest(username, entityHash, manifest)
	await commitTimelineEvent(username, entityHash, {
		type: 'emoji_pack_upsert',
		content: manifestEventContent(manifest),
	})
	return manifest
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {string} packId pack
 * @param {{ localized?: object, visibility?: string }} patch 更新字段
 * @returns {Promise<object>} 结果
 */
export async function updateEntityPack(username, entityHash, packId, patch = {}) {
	const manifest = await loadLocalEntityPack(username, entityHash, packId)
	if (!manifest) throw new Error('pack not found')
	if (patch.localized && typeof patch.localized === 'object')
		manifest.localized = patch.localized
	if (patch.visibility != null)
		manifest.visibility = String(patch.visibility || 'followers')
	await saveLocalManifest(username, entityHash, manifest)
	await commitTimelineEvent(username, entityHash, {
		type: 'emoji_pack_upsert',
		content: manifestEventContent(manifest),
	})
	return manifest
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {string} packId pack
 * @returns {Promise<boolean>} 是否成功
 */
export async function deleteEntityPack(username, entityHash, packId) {
	const pid = String(packId || '').trim()
	const dir = entityEmojiPackDir(username, entityHash, pid)
	if (!await fileExists(dir)) return false
	await fs.rm(dir, { recursive: true, force: true })
	await commitTimelineEvent(username, entityHash, {
		type: 'emoji_pack_delete',
		content: { packId: pid },
	})
	return true
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {string} packId pack
 * @param {Buffer} buffer 图片
 * @param {string} [filename] 文件名
 * @param {string} [mimeType] MIME
 * @param {string} [name] 显示名
 * @returns {Promise<object>} item
 */
export async function uploadEntityPackEmoji(username, entityHash, packId, buffer, filename, mimeType, name) {
	void filename
	if (!Buffer.isBuffer(buffer) || buffer.byteLength < 1 || buffer.byteLength > MAX_EMOJI_BYTES)
		throw new Error('invalid emoji image')
	let manifest = await loadLocalEntityPack(username, entityHash, packId)
	if (!manifest)
		manifest = await createEntityPack(username, entityHash, { packId })

	const emojiId = prefixedRandomId('e_')
	const resolvedMime = mimeType || 'image/png'
	const displayName = String(name || emojiId).trim() || emojiId
	const contentHash = computeEmojiContentHash(buffer)
	await putChunk(contentHash, buffer)

	const vault = await putVaultFileManifest(username, entityHash, {
		plaintext: buffer,
		name: `${emojiId}.bin`,
		mimeType: resolvedMime,
		visibility: 'followers',
	})

	const item = {
		emojiId,
		localized: { 'en-UK': { name: displayName } },
		name: displayName,
		mimeType: resolvedMime,
		animated: resolvedMime.includes('gif'),
		contentHash,
		vaultFileId: vault.fileId,
		vaultPath: vault.logicalPath,
		uploadedAt: Date.now(),
	}
	manifest.items.push(item)
	await saveLocalManifest(username, entityHash, manifest)
	await commitTimelineEvent(username, entityHash, {
		type: 'emoji_pack_upsert',
		content: manifestEventContent(manifest),
	})
	return item
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {string} packId pack
 * @param {string} emojiId emoji
 * @returns {Promise<boolean>} 是否成功
 */
export async function deleteEntityPackEmoji(username, entityHash, packId, emojiId) {
	const manifest = await loadLocalEntityPack(username, entityHash, packId)
	if (!manifest) return false
	const before = manifest.items.length
	manifest.items = manifest.items.filter(i => i.emojiId !== emojiId)
	if (manifest.items.length === before) return false
	await saveLocalManifest(username, entityHash, manifest)
	await commitTimelineEvent(username, entityHash, {
		type: 'emoji_pack_upsert',
		content: manifestEventContent(manifest),
	})
	return true
}

/**
 * 可用作者包 = 自身 ∪ 已关注作者时间线中的 packs。
 * @param {string} username replica
 * @param {{ viewerEntityHash?: string, skipConverge?: boolean }} [options] 选项
 * @returns {Promise<object[]>} pack 列表
 */
export async function listAvailableEntityPacksForUser(username, options = {}) {
	const owners = await listFollowedTimelineOwners(username, options.viewerEntityHash)
	/** @type {object[]} */
	const out = []
	const seen = new Set()

	for (const owner of owners) {
		const profile = await getProfile(owner, username, { skipPresentation: true, fetchRemote: true }).catch(() => null)
		const defaultEmojiPackId = String(profile?.defaultEmojiPackId || '').trim() || null
		if (defaultEmojiPackId && !options.skipConverge)
			convergeLinkedDefault(username, entityDefaultLinkKey(owner), defaultEmojiPackId)

		let packs = await listLocalEntityPacks(username, owner)
		if (!packs.length)
			packs = await listTimelineEntityPacks(username, owner)

		const infoDefaults = {
			name: owner.slice(0, 8),
			avatar: null,
		}
		for (const pack of packs) {
			if (seen.has(pack.packId)) continue
			seen.add(pack.packId)
			out.push({
				...pack,
				source: pack.source || { kind: 'entity', id: owner },
				entityHash: owner,
				defaultEmojiPackId,
				infoDefaults,
			})
		}
	}
	return out
}

/**
 * @param {string} username replica
 * @param {string} packId pack
 * @returns {Promise<{ entityHash: string, pack: object } | null>} 定位结果
 */
export async function findEntityPackForUser(username, packId) {
	const pid = String(packId || '').trim()
	if (!pid) return null
	const packs = await listAvailableEntityPacksForUser(username, { skipConverge: true })
	const hit = packs.find(p => p.packId === pid)
	if (!hit) return null
	return { entityHash: hit.entityHash || hit.source?.id, pack: hit }
}

/**
 * pack 是否对用户可用（自身 / 已加群由 chat 侧另判；此处仅作者包）。
 * @param {string} username replica
 * @param {string} packId pack
 * @returns {Promise<boolean>} 是否成功
 */
export async function isEntityPackAvailableToUser(username, packId) {
	return Boolean(await findEntityPackForUser(username, packId))
}

/**
 * 关注成功后：把对方默认表情包写入 chat 收藏（与 POST /emoji-usage/collection/packs 同效）。
 * @param {string} username replica
 * @param {string} targetEntityHash 被关注者
 * @returns {Promise<void>}
 */
export async function linkFollowedAuthorDefaultPack(username, targetEntityHash) {
	const hash = String(targetEntityHash || '').trim().toLowerCase()
	if (!hash) return
	const profile = await getProfile(hash, username, { skipPresentation: true, fetchRemote: true }).catch(() => null)
	const packId = String(profile?.defaultEmojiPackId || '').trim()
	if (!packId) return
	convergeLinkedDefault(username, entityDefaultLinkKey(hash), packId)
}

/**
 * @returns {string} 占位随机 id（测试用导出）
 */
export function newEmojiPackId() {
	return prefixedRandomId('epack_') || `epack_${randomUUID()}`
}
