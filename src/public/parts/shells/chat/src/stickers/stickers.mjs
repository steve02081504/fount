/**
 * 【文件】stickers/stickers.mjs
 * 【职责】贴纸包与单张贴纸的磁盘存储、作者 entity 隔离、用户收藏安装及媒体 URL 生成。
 * 【原理】每作者 entityHash 下 packs/<packId>/manifest + media；安装/收藏写入 shellData collection；跨 replica 查找 findStickerPackHost；导入支持 data URL。
 * 【数据结构】StickerPack、Sticker、UserStickerCollection（installedPacks/favorites/recent）。
 * 【关联】被 stickers/endpoints.mjs、actions.mjs 调用；依赖 collection/index、chat/lib/paths、chatAuxAPI 类型。
 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { geti18nForUser } from '../../../../../../scripts/i18n.mjs'
import { loadJsonFile, saveJsonFile } from '../../../../../../scripts/json_loader.mjs'
import { putChunk } from '../../../../../../scripts/p2p/files/chunk_store.mjs'
import { getAllUserNames } from '../../../../../../server/auth.mjs'
import {
	entityStickerPackDir,
	entityStickerPackMediaDir,
	entityStickersPacksRoot,
	userEntitiesRoot,
} from '../chat/lib/paths.mjs'

import {
	loadUserStickerCollection,
	saveUserStickerCollection,
} from './collection/index.mjs'

/** @typedef {import('../../../../../../decl/chatAuxAPI.ts').StickerPack} StickerPack */
/** @typedef {import('../../../../../../decl/chatAuxAPI.ts').Sticker} Sticker */
/** @typedef {import('../../../../../../decl/chatAuxAPI.ts').UserStickerCollection} UserStickerCollection */

const STICKER_API = '/api/parts/shells:chat/stickers'

/**
 * @param {Buffer} buffer 贴纸字节
 * @returns {string} sha256 hex
 */
export function computeStickerContentHash(buffer) {
	return createHash('sha256').update(buffer).digest('hex')
}

/**
 * @param {Buffer} buffer 贴纸字节
 * @returns {Promise<string>} contentHash
 */
export async function storeStickerInCas(buffer) {
	const contentHash = computeStickerContentHash(buffer)
	await putChunk(contentHash, buffer)
	return contentHash
}

/**
 * 贴纸二进制文件的 API URL。
 * @param {string} packId 贴纸包 ID
 * @param {string} filename 磁盘文件名
 * @returns {string} 贴纸媒体 API URL
 */
export function stickerMediaUrl(packId, filename) {
	return `${STICKER_API}/packs/${encodeURIComponent(packId)}/file/${encodeURIComponent(filename)}`
}

/**
 * 解析贴纸二进制文件的磁盘绝对路径。
 * @param {string} replicaUsername replica 磁盘所有者
 * @param {string} authorEntityHash 作者 entityHash
 * @param {string} packId 贴纸包 ID
 * @param {string} filename 磁盘文件名
 * @returns {string} 绝对路径
 */
export function resolveStickerFilePath(replicaUsername, authorEntityHash, packId, filename) {
	return path.join(entityStickerPackMediaDir(replicaUsername, authorEntityHash, packId), filename)
}

/**
 * 贴纸包 `config.json` 的绝对路径。
 * @param {string} replicaUsername replica 所有者
 * @param {string} authorEntityHash 作者 entityHash
 * @param {string} packId 贴纸包 ID
 * @returns {string} config.json 绝对路径
 */
function packConfigPath(replicaUsername, authorEntityHash, packId) {
	return path.join(entityStickerPackDir(replicaUsername, authorEntityHash, packId), 'config.json')
}

/**
 * @param {string} packId 贴纸包 ID
 * @returns {{ replicaUsername: string, authorEntityHash: string } | null} 托管位置
 */
export function findStickerPackHost(packId) {
	for (const replicaUsername of getAllUserNames()) {
		const entitiesRoot = userEntitiesRoot(replicaUsername)
		if (!fs.existsSync(entitiesRoot)) continue
		for (const authorEntityHash of fs.readdirSync(entitiesRoot))
			if (fs.existsSync(packConfigPath(replicaUsername, authorEntityHash, packId)))
				return { replicaUsername, authorEntityHash }

	}
	return null
}

/**
 * 获取贴纸包列表
 * @param {string} [viewerEntityHash] - 查看者 entityHash（可选，用于过滤可见包）
 * @returns {Promise<StickerPack[]>} 符合条件的贴纸包列表
 */
export async function getStickerPacks(viewerEntityHash = null) {
	/** @type {StickerPack[]} */
	const packs = []
	const seen = new Set()

	for (const replicaUsername of getAllUserNames()) {
		const entitiesRoot = userEntitiesRoot(replicaUsername)
		try {
			await fsp.access(entitiesRoot)
		}
		catch {
			continue
		}
		for (const authorEntityHash of await fsp.readdir(entitiesRoot)) {
			const root = entityStickersPacksRoot(replicaUsername, authorEntityHash)
			try {
				await fsp.access(root)
			}
			catch {
				continue
			}
			for (const packId of await fsp.readdir(root)) {
				if (seen.has(packId)) continue
				try {
					const config = await loadJsonFile(packConfigPath(replicaUsername, authorEntityHash, packId))
					if (!viewerEntityHash || config.isPublic || config.authorEntityHash === viewerEntityHash) {
						packs.push(config)
						seen.add(packId)
					}
				}
				catch (error) {
					console.error(`Error loading sticker pack ${packId}:`, error)
				}
			}
		}
	}
	return packs
}

/**
 * 创建贴纸包
 * @param {string} replicaUsername replica 所有者
 * @param {string} authorEntityHash 作者 entityHash
 * @param {Partial<StickerPack>} pack - 贴纸包配置
 * @returns {Promise<StickerPack>} 新建贴纸包的完整配置
 */
export async function createStickerPack(replicaUsername, authorEntityHash, pack) {
	const packId = `pack_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	const mediaDir = entityStickerPackMediaDir(replicaUsername, authorEntityHash, packId)
	await fsp.mkdir(mediaDir, { recursive: true })


	const trimmedName = String(pack.name || '').trim()
	const trimmedDescription = String(pack.description || '').trim()
	const packConfig = {
		packId,
		name: trimmedName
			? pack.name
			: pack.useDefaultLocaleNames
				? await geti18nForUser(replicaUsername, 'stickers.defaultPackName')
				: await geti18nForUser(replicaUsername, 'stickers.unnamedPack'),
		authorEntityHash,
		description: trimmedDescription
			? pack.description
			: pack.useDefaultLocaleNames
				? await geti18nForUser(replicaUsername, 'stickers.defaultPackDescription')
				: '',
		thumbnail: pack.thumbnail || '',
		stickers: [],
		isPublic: pack.isPublic ?? true,
		createdAt: Date.now(),
		updatedAt: Date.now()
	}

	await saveJsonFile(packConfigPath(replicaUsername, authorEntityHash, packId), packConfig)
	return packConfig
}

/**
 * 获取贴纸包详情
 * @param {string} packId - 贴纸包ID
 * @returns {Promise<StickerPack>} 贴纸包配置对象
 */
export async function getStickerPack(packId) {
	const host = findStickerPackHost(packId)
	if (!host)
		throw new Error('Sticker pack not found')
	return await loadJsonFile(packConfigPath(host.replicaUsername, host.authorEntityHash, packId))
}

/**
 * 更新贴纸包
 * @param {string} packId - 贴纸包ID
 * @param {Partial<StickerPack>} updates - 更新内容
 * @returns {Promise<StickerPack>} 合并更新后的贴纸包配置
 */
export async function updateStickerPack(packId, updates) {
	const config = await getStickerPack(packId)

	const updatedConfig = {
		...config,
		...updates,
		packId,
		authorEntityHash: config.authorEntityHash,
		createdAt: config.createdAt,
		updatedAt: Date.now()
	}

	const host = findStickerPackHost(packId)
	if (!host) throw new Error('Sticker pack not found')
	await saveJsonFile(packConfigPath(host.replicaUsername, host.authorEntityHash, packId), updatedConfig)
	return updatedConfig
}

/**
 * 删除贴纸包
 * @param {string} packId - 贴纸包ID
 * @returns {Promise<void>} 无返回值
 */
export async function deleteStickerPack(packId) {
	const host = findStickerPackHost(packId)
	if (!host)
		throw new Error('Sticker pack not found')
	const packDir = entityStickerPackDir(host.replicaUsername, host.authorEntityHash, packId)
	await fsp.rm(packDir, { recursive: true, force: true })
}

/**
 * 上传贴纸
 * @param {string} packId - 贴纸包ID
 * @param {Buffer} fileBuffer - 文件缓冲区
 * @param {string} filename - 文件名
 * @param {Partial<Sticker>} metadata - 贴纸元数据
 * @returns {Promise<Sticker>} 持久化后的贴纸对象
 */
export async function uploadSticker(packId, fileBuffer, filename, metadata) {
	const pack = await getStickerPack(packId)
	const host = findStickerPackHost(packId)
	if (!host) throw new Error('Sticker pack not found')

	const ext = path.extname(filename)
	const stickerId = `sticker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	const uniqueFilename = `${stickerId}${ext}`
	const mediaDir = entityStickerPackMediaDir(host.replicaUsername, host.authorEntityHash, packId)
	await fsp.mkdir(mediaDir, { recursive: true })
	const stickerPath = path.join(mediaDir, uniqueFilename)

	await fsp.writeFile(stickerPath, fileBuffer)

	const contentHash = await storeStickerInCas(fileBuffer)
	const sticker = {
		id: stickerId,
		name: metadata.name || path.basename(filename, ext),
		url: stickerMediaUrl(packId, uniqueFilename),
		tags: metadata.tags || [],
		animated: ext.toLowerCase() === '.gif',
		contentHash,
	}

	pack.stickers.push(sticker)
	pack.updatedAt = Date.now()
	await saveJsonFile(packConfigPath(host.replicaUsername, host.authorEntityHash, packId), pack)

	return sticker
}

/**
 * 删除贴纸
 * @param {string} packId - 贴纸包ID
 * @param {string} stickerId - 贴纸ID
 * @returns {Promise<void>} 无返回值
 */
export async function deleteSticker(packId, stickerId) {
	const pack = await getStickerPack(packId)

	const sticker = pack.stickers.find(s => s.id === stickerId)
	if (!sticker)
		throw new Error('Sticker not found')

	const host = findStickerPackHost(packId)
	if (!host) throw new Error('Sticker pack not found')

	const filename = path.basename(sticker.url)
	const stickerPath = resolveStickerFilePath(host.replicaUsername, host.authorEntityHash, packId, filename)
	try {
		await fsp.unlink(stickerPath)
	}
	catch { }

	pack.stickers = pack.stickers.filter(s => s.id !== stickerId)
	pack.updatedAt = Date.now()
	await saveJsonFile(packConfigPath(host.replicaUsername, host.authorEntityHash, packId), pack)
}

/**
 * 获取用户贴纸收藏
 * @param {string} username - 用户名
 * @returns {Promise<UserStickerCollection>} 用户贴纸收藏数据
 */
export async function getUserCollection(username) {
	return loadUserStickerCollection(username)
}

/**
 * 安装贴纸包
 * @param {string} username - 用户名
 * @param {string} packId - 贴纸包ID
 * @returns {Promise<void>} 无返回值
 */
export async function installPack(username, packId) {
	const collection = await getUserCollection(username)

	if (collection.installedPacks.includes(packId))
		throw new Error('Pack already installed')


	collection.installedPacks.push(packId)
	saveUserStickerCollection(username, collection)
}

/**
 * 卸载贴纸包
 * @param {string} username - 用户名
 * @param {string} packId - 贴纸包ID
 * @returns {Promise<void>} 无返回值
 */
export async function uninstallPack(username, packId) {
	const collection = await getUserCollection(username)

	if (!collection.installedPacks.includes(packId))
		throw new Error('Pack not installed')


	collection.installedPacks = collection.installedPacks.filter(id => id !== packId)
	saveUserStickerCollection(username, collection)
}

/**
 * 添加到收藏
 * @param {string} username - 用户名
 * @param {string} stickerId - 贴纸ID
 * @returns {Promise<void>} 无返回值
 */
export async function addToFavorites(username, stickerId) {
	const collection = await getUserCollection(username)

	if (!collection.favoriteStickers.includes(stickerId)) {
		collection.favoriteStickers.push(stickerId)
		saveUserStickerCollection(username, collection)
	}
}

/**
 * 从收藏移除
 * @param {string} username - 用户名
 * @param {string} stickerId - 贴纸ID
 * @returns {Promise<void>} 无返回值
 */
export async function removeFromFavorites(username, stickerId) {
	const collection = await getUserCollection(username)

	collection.favoriteStickers = collection.favoriteStickers.filter(id => id !== stickerId)
	saveUserStickerCollection(username, collection)
}

/**
 * 解析 data URL 为二进制（§6 贴纸 base64 上限 2MB）。
 * @param {string} dataUrl data:image/…;base64,…
 * @returns {{ mime: string, buffer: import('node:buffer').Buffer }} MIME 与字节
 */
export function decodeStickerDataUrl(dataUrl) {
	const raw = String(dataUrl || '').trim()
	const m = /^data:([^;]+);base64,(.+)$/iu.exec(raw)
	if (!m) throw new Error('invalid data URL')
	const buffer = /** @type {import('node:buffer').Buffer} */ Buffer.from(m[2], 'base64')
	if (buffer.length > 2 * 1024 * 1024) throw new Error('sticker exceeds 2MB limit')
	return { mime: m[1], buffer }
}

/**
 * 确保用户拥有可写入的贴纸包（无则创建「我的收藏」并安装）。
 * @param {string} replicaUsername replica 磁盘所有者
 * @param {string} authorEntityHash 作者 entityHash
 * @returns {Promise<string>} packId
 */
export async function ensureUserImportPack(replicaUsername, authorEntityHash) {
	const packs = await getStickerPacks(authorEntityHash)
	const owned = packs.find(p => p.authorEntityHash === authorEntityHash)
	if (owned) return owned.packId
	const pack = await createStickerPack(replicaUsername, authorEntityHash, {
		name: await geti18nForUser(replicaUsername, 'stickers.importPackName'),
		description: await geti18nForUser(replicaUsername, 'stickers.importPackDescription'),
		isPublic: false,
	})
	const collection = await getUserCollection(replicaUsername)
	if (!collection.installedPacks.includes(pack.packId))
		await installPack(replicaUsername, pack.packId)
	return pack.packId
}

/**
 * 从 data URL 导入贴纸到用户包并加入收藏（§6 贴纸）。
 * @param {string} replicaUsername replica 所有者
 * @param {string} authorEntityHash 作者 entityHash
 * @param {string} dataUrl 图片 data URL
 * @param {string} [name] 显示名
 * @returns {Promise<Sticker>} 新贴纸条目
 */
export async function importStickerFromDataUrl(replicaUsername, authorEntityHash, dataUrl, name) {
	const { mime, buffer } = decodeStickerDataUrl(dataUrl)
	const ext = mime.includes('png') ? '.png'
		: mime.includes('gif') ? '.gif'
			: mime.includes('webp') ? '.webp'
				: '.jpg'
	const packId = await ensureUserImportPack(replicaUsername, authorEntityHash)
	const sticker = await uploadSticker(packId, buffer, `saved${ext}`, { name: name || 'saved' })
	await addToFavorites(replicaUsername, sticker.id)
	await recordRecentUse(replicaUsername, sticker.id)
	return sticker
}

/**
 * 记录最近使用
 * @param {string} username 用户名
 * @param {string} stickerId 贴纸 ID
 * @returns {Promise<void>}
 */
export async function recordRecentUse(username, stickerId) {
	const collection = await getUserCollection(username)

	// 移除旧的记录
	collection.recentStickers = collection.recentStickers.filter(id => id !== stickerId)

	// 添加到开头
	collection.recentStickers.unshift(stickerId)

	// 限制最多50个
	if (collection.recentStickers.length > 50)
		collection.recentStickers = collection.recentStickers.slice(0, 50)


	saveUserStickerCollection(username, collection)
}
