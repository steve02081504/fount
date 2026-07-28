/**
 * 群表情包（emoji_packs）：多 pack 的 manifest / 二进制存储与解析。
 * 布局：`{groupDir}/emoji_packs/{packId}/{manifest.json,binaries/}`；旧 `group_emojis/` 不读。
 */
import path from 'node:path'

import { groupDir } from '../chat/lib/paths.mjs'
import { listUserGroups } from '../chat/lib/userGroups.mjs'
import * as store from '../emojiPacks/packStore.mjs'

/** 复用 packStore 中的通用工具与常量。 */
export {
	computeEmojiContentHash,
	storeEmojiInCas,
	itemDisplayName,
	packSummary,
	bufferToDataUrl,
	MAX_EMOJI_BYTES,
} from '../emojiPacks/packStore.mjs'

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @returns {string} emoji_packs 根目录
 */
export function groupEmojiPacksRoot(username, groupId) {
	return path.join(groupDir(username, groupId), 'emoji_packs')
}

/**
 * @param {string} groupId 群 ID
 * @returns {{ kind: 'group', id: string }} source
 */
function groupSource(groupId) {
	return { kind: 'group', id: groupId }
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} packId 表情包 ID
 * @returns {string} 包目录
 */
export function packDir(username, groupId, packId) {
	return store.packDir(groupEmojiPacksRoot(username, groupId), packId)
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @returns {Promise<string[]>} packId 列表
 */
export async function listGroupPackIds(username, groupId) {
	return store.listPackIds(groupEmojiPacksRoot(username, groupId))
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} packId 表情包 ID
 * @returns {Promise<object | null>} manifest
 */
export async function loadPackManifest(username, groupId, packId) {
	return store.loadPackManifest(groupEmojiPacksRoot(username, groupId), packId, groupSource(groupId))
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @returns {Promise<object[]>} pack 列表
 */
export async function listGroupPacks(username, groupId) {
	return store.listPacks(groupEmojiPacksRoot(username, groupId), groupSource(groupId))
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {{ packId?: string, localized?: object }} [fields] 创建字段
 * @returns {Promise<object>} manifest
 */
export async function createPack(username, groupId, fields = {}) {
	const packId = String(fields.packId || groupId).trim() || groupId
	return store.createPack(groupEmojiPacksRoot(username, groupId), groupSource(groupId), {
		...fields,
		packId,
	})
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} packId 表情包 ID
 * @param {{ localized?: object }} patch 更新字段
 * @returns {Promise<object>} manifest
 */
export async function updatePack(username, groupId, packId, patch = {}) {
	return store.updatePack(groupEmojiPacksRoot(username, groupId), groupSource(groupId), packId, patch)
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} packId 表情包 ID
 * @returns {Promise<boolean>} 是否删除
 */
export async function deletePack(username, groupId, packId) {
	return store.deletePack(groupEmojiPacksRoot(username, groupId), packId)
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} 默认 pack
 */
export async function ensureDefaultGroupPack(username, groupId) {
	const existing = await loadPackManifest(username, groupId, groupId)
	if (existing) return existing
	return createPack(username, groupId, { packId: groupId })
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} packId 表情包 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<object | null>} 条目
 */
export async function getPackEmojiEntry(username, groupId, packId, emojiId) {
	return store.getPackEmojiEntry(groupEmojiPacksRoot(username, groupId), groupSource(groupId), packId, emojiId)
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<{ packId: string, entry: object } | null>} 命中
 */
export async function findEmojiInGroupPacks(username, groupId, emojiId) {
	const eid = String(emojiId || '').trim()
	if (!eid) return null
	for (const packId of await listGroupPackIds(username, groupId)) {
		const entry = await getPackEmojiEntry(username, groupId, packId, eid)
		if (entry) return { packId, entry }
	}
	return null
}

/**
 * @param {string} username 用户名
 * @param {string} packId 表情包 ID
 * @returns {Promise<{ groupId: string, packId: string, manifest: object } | null>} 定位结果
 */
export async function findPackAcrossGroups(username, packId) {
	const pid = String(packId || '').trim()
	if (!pid) return null
	const direct = await loadPackManifest(username, pid, pid)
	if (direct) return { groupId: pid, packId: pid, manifest: direct }
	for (const groupId of await listUserGroups(username)) {
		if (groupId === pid) continue
		const manifest = await loadPackManifest(username, groupId, pid)
		if (manifest) return { groupId, packId: pid, manifest }
	}
	return null
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} packId 表情包 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<string | null>} 文件路径
 */
export async function resolvePackEmojiBinaryPath(username, groupId, packId, emojiId) {
	const entry = await getPackEmojiEntry(username, groupId, packId, emojiId)
	if (!entry) return null
	const filePath = path.join(
		store.packBinariesDir(groupEmojiPacksRoot(username, groupId), packId),
		store.binaryFilename(entry),
	)
	return await store.fileExists(filePath) ? filePath : null
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} packId 表情包 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<{ buffer: Buffer, mimeType: string, entry: object, packId: string } | null>} 二进制
 */
export async function readPackEmojiBinary(username, groupId, packId, emojiId) {
	return store.readPackEmojiBinary(groupEmojiPacksRoot(username, groupId), groupSource(groupId), packId, emojiId)
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @param {string} [packId] 表情包 ID
 * @returns {Promise<{ buffer: Buffer, mimeType: string, entry: object, packId: string } | null>} 二进制
 */
export async function readGroupEmojiBinary(username, groupId, emojiId, packId) {
	const pid = String(packId || '').trim()
	if (pid) return readPackEmojiBinary(username, groupId, pid, emojiId)
	const direct = await readPackEmojiBinary(username, groupId, groupId, emojiId)
	if (direct) return direct
	const found = await findEmojiInGroupPacks(username, groupId, emojiId)
	if (!found) return null
	return readPackEmojiBinary(username, groupId, found.packId, emojiId)
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @param {string} [packId] 表情包 ID
 * @returns {Promise<object | null>} 条目
 */
export async function getGroupEmojiEntry(username, groupId, emojiId, packId) {
	const pid = String(packId || '').trim()
	if (pid) return getPackEmojiEntry(username, groupId, pid, emojiId)
	const direct = await getPackEmojiEntry(username, groupId, groupId, emojiId)
	if (direct) return direct
	const found = await findEmojiInGroupPacks(username, groupId, emojiId)
	return found?.entry || null
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @param {string} [packId] 表情包 ID
 * @returns {Promise<string | null>} 文件路径
 */
export async function resolveGroupEmojiBinaryPath(username, groupId, emojiId, packId) {
	const pid = String(packId || '').trim()
	if (pid) return resolvePackEmojiBinaryPath(username, groupId, pid, emojiId)
	const direct = await resolvePackEmojiBinaryPath(username, groupId, groupId, emojiId)
	if (direct) return direct
	const found = await findEmojiInGroupPacks(username, groupId, emojiId)
	if (!found) return null
	return resolvePackEmojiBinaryPath(username, groupId, found.packId, emojiId)
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @returns {Promise<object[]>} 展平条目
 */
export async function loadGroupEmojiManifest(username, groupId) {
	const packs = await listGroupPacks(username, groupId)
	/** @type {object[]} */
	const entries = []
	for (const pack of packs)
		for (const item of pack.items || [])
			entries.push({
				...item,
				packId: pack.packId,
				name: store.itemDisplayName(item) || item.emojiId,
			})
	return entries
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} packId 表情包 ID
 * @param {Buffer} buffer 图片字节
 * @param {string} originalname 原始文件名
 * @param {string} mimeType MIME
 * @param {string} [name] 显示名
 * @returns {Promise<object>} 新条目
 */
export async function uploadPackEmoji(username, groupId, packId, buffer, originalname, mimeType, name) {
	return store.uploadPackEmoji(
		groupEmojiPacksRoot(username, groupId),
		groupSource(groupId),
		packId,
		buffer,
		originalname,
		mimeType,
		name,
		username,
	)
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {Buffer} buffer 图片字节
 * @param {string} originalname 原始文件名
 * @param {string} mimeType MIME
 * @param {string} [name] 显示名
 * @returns {Promise<object>} 新条目
 */
export async function uploadGroupEmoji(username, groupId, buffer, originalname, mimeType, name) {
	await ensureDefaultGroupPack(username, groupId)
	return uploadPackEmoji(username, groupId, groupId, buffer, originalname, mimeType, name)
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} packId 表情包 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<boolean>} 是否删除
 */
export async function deletePackEmoji(username, groupId, packId, emojiId) {
	return store.deletePackEmoji(groupEmojiPacksRoot(username, groupId), groupSource(groupId), packId, emojiId)
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<boolean>} 是否删除
 */
export async function deleteGroupEmoji(username, groupId, emojiId) {
	if (await deletePackEmoji(username, groupId, groupId, emojiId)) return true
	const found = await findEmojiInGroupPacks(username, groupId, emojiId)
	if (!found) return false
	return deletePackEmoji(username, groupId, found.packId, emojiId)
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {object} entry 至少含 emojiId；可含 packId
 * @returns {Promise<object>} 合并后条目
 */
export async function upsertGroupEmojiManifestEntry(username, groupId, entry) {
	const emojiId = String(entry?.emojiId || '').trim()
	if (!emojiId) throw new Error('emojiId required')
	const packId = String(entry.packId || groupId).trim() || groupId
	const root = groupEmojiPacksRoot(username, groupId)
	const source = groupSource(groupId)
	let manifest = await store.loadPackManifest(root, packId, source)
	if (!manifest) {
		manifest = store.emptyPackManifest(source, packId)
		await store.savePackManifest(root, manifest)
		manifest = await store.loadPackManifest(root, packId, source)
	}
	const existing = manifest.items.find(row => row?.emojiId === emojiId)
	const name = String(entry.name ?? store.itemDisplayName(existing) ?? emojiId)
	const mimeType = String(entry.mimeType || existing?.mimeType || 'image/png')
	const ext = String(entry.ext || existing?.ext || store.extFromMime(mimeType))
	const animated = entry.animated != null ? Boolean(entry.animated) : Boolean(existing?.animated ?? mimeType.includes('gif'))
	const contentHashRaw = String(entry.contentHash || '').trim().toLowerCase()
	const contentHash = /^[\da-f]{64}$/u.test(contentHashRaw) ? contentHashRaw : undefined
	const merged = {
		...existing || {
			emojiId,
			localized: store.localizedFromName(name),
			uploadedAt: Date.now(),
			uploadedBy: 'federation',
		},
		emojiId,
		name,
		mimeType,
		ext,
		animated,
		...contentHash ? { contentHash } : {},
	}
	if (entry.name && !entry.localized)
		merged.localized = { ...merged.localized, ...store.localizedFromName(name) }
	if (existing) Object.assign(existing, merged)
	else manifest.items.push(merged)
	await store.savePackManifest(root, manifest)
	return { ...merged, packId }
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @param {string} dataUrl data URL
 * @param {string} mimeType MIME
 * @param {string} [name] 显示名
 * @param {string} [packId] 表情包 ID
 * @returns {Promise<object>} 条目
 */
export async function persistGroupEmojiFromDataUrl(username, groupId, emojiId, dataUrl, mimeType, name, packId) {
	const pid = String(packId || groupId).trim() || groupId
	return store.persistEmojiFromDataUrl(
		groupEmojiPacksRoot(username, groupId),
		groupSource(groupId),
		pid,
		emojiId,
		dataUrl,
		mimeType,
		name,
	)
}

/**
 * @param {string} username 用户名
 * @param {{ groupId?: string }} [options] 可选过滤
 * @returns {Promise<object[]>} 可用 pack
 */
export async function listAvailableGroupPacksForUser(username, options = {}) {
	const filterGroupId = String(options.groupId || '').trim() || null
	const { getState } = await import('../chat/dag/materialize.mjs')
	const { resolveActiveMemberKeyForLocalReplica } = await import('./access.mjs')

	const groupIds = filterGroupId ? [filterGroupId] : await listUserGroups(username)
	const settled = await Promise.all(groupIds.map(async groupId => {
		let state
		try {
			({ state } = await getState(username, groupId, { skipLeftPurge: true }))
		}
		catch {
			return []
		}
		const memberKey = await resolveActiveMemberKeyForLocalReplica(username, groupId, state)
		if (!memberKey) return []
		const member = state.members?.[memberKey]
		const joinedAt = member?.joinedAt ?? null
		const defaultEmojiPackId = state.groupSettings?.defaultEmojiPackId || null
		const infoDefaults = {
			name: state.groupMeta?.name || groupId,
			avatar: state.groupMeta?.avatar ?? null,
		}
		const packs = await listGroupPacks(username, groupId)
		return packs.map(pack => ({
			...pack,
			groupId,
			joinedAt,
			defaultEmojiPackId,
			infoDefaults,
		}))
	}))
	return settled.flat()
}
