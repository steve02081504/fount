import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadJsonFile, saveJsonFile } from '../../../../../../scripts/json_loader.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** @typedef {import('../../decl/chatAuxAPI.ts').StickerPack} StickerPack */
/** @typedef {import('../../decl/chatAuxAPI.ts').Sticker} Sticker */
/** @typedef {import('../../decl/chatAuxAPI.ts').UserStickerCollection} UserStickerCollection */

const STICKERS_DIR = path.join(process.cwd(), 'data', 'stickers', 'packs')
const UPLOADS_DIR = path.join(process.cwd(), 'data', 'uploads', 'stickers')

// 确保目录存在
if (!fs.existsSync(STICKERS_DIR)) 
	fs.mkdirSync(STICKERS_DIR, { recursive: true })

if (!fs.existsSync(UPLOADS_DIR)) 
	fs.mkdirSync(UPLOADS_DIR, { recursive: true })


/**
 * 获取贴纸包配置文件路径
 * @param {string} packId - 贴纸包ID
 * @returns {string} config.json 的绝对路径
 */
function getPackConfigPath(packId) {
	return path.join(STICKERS_DIR, packId, 'config.json')
}

/**
 * 获取用户贴纸收藏文件路径
 * @param {string} username - 用户名
 * @returns {string} 用户 stickers.json 的绝对路径
 */
function getUserCollectionPath(username) {
	return path.join(process.cwd(), 'data', 'users', username, 'stickers.json')
}

/**
 * 获取贴纸包列表
 * @param {string} [username] - 用户名（可选，用于过滤可见包）
 * @returns {Promise<StickerPack[]>} 符合条件的贴纸包列表
 */
export async function getStickerPacks(username = null) {
	const packs = []

	if (!fs.existsSync(STICKERS_DIR)) 
		return packs
	

	const packDirs = fs.readdirSync(STICKERS_DIR)

	for (const packId of packDirs) 
		try {
			const config = await getStickerPack(packId)
			// 如果指定了用户名，只返回公开的或用户自己的贴纸包
			if (!username || config.isPublic || config.author === username) 
				packs.push(config)
			
		} catch (error) {
			console.error(`Error loading sticker pack ${packId}:`, error)
		}
	

	return packs
}

/**
 * 创建贴纸包
 * @param {string} username - 用户名
 * @param {Partial<StickerPack>} pack - 贴纸包配置
 * @returns {Promise<StickerPack>} 新建贴纸包的完整配置
 */
export async function createStickerPack(username, pack) {
	const packId = `pack_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	const packDir = path.join(STICKERS_DIR, packId)
	const stickersDir = path.join(packDir, 'stickers')

	// 创建目录
	if (!fs.existsSync(stickersDir)) 
		fs.mkdirSync(stickersDir, { recursive: true })
	

	const packConfig = {
		packId,
		name: pack.name || '未命名贴纸包',
		author: username,
		description: pack.description || '',
		thumbnail: pack.thumbnail || '',
		stickers: [],
		isPublic: pack.isPublic ?? true,
		createdAt: Date.now(),
		updatedAt: Date.now()
	}

	await saveJsonFile(getPackConfigPath(packId), packConfig)
	return packConfig
}

/**
 * 获取贴纸包详情
 * @param {string} packId - 贴纸包ID
 * @returns {Promise<StickerPack>} 贴纸包配置对象
 */
export async function getStickerPack(packId) {
	const configPath = getPackConfigPath(packId)
	if (!fs.existsSync(configPath)) 
		throw new Error('Sticker pack not found')
	
	return await loadJsonFile(configPath)
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
		author: config.author,
		createdAt: config.createdAt,
		updatedAt: Date.now()
	}

	await saveJsonFile(getPackConfigPath(packId), updatedConfig)
	return updatedConfig
}

/**
 * 删除贴纸包
 * @param {string} packId - 贴纸包ID
 * @returns {Promise<void>} 无返回值
 */
export async function deleteStickerPack(packId) {
	const packDir = path.join(STICKERS_DIR, packId)
	if (fs.existsSync(packDir)) 
		fs.rmSync(packDir, { recursive: true, force: true })
	
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

	// 生成唯一文件名
	const ext = path.extname(filename)
	const stickerId = `sticker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	const uniqueFilename = `${stickerId}${ext}`
	const uploadPackDir = path.join(UPLOADS_DIR, packId)
	if (!fs.existsSync(uploadPackDir))
		fs.mkdirSync(uploadPackDir, { recursive: true })
	const stickerPath = path.join(uploadPackDir, uniqueFilename)

	// 保存文件
	fs.writeFileSync(stickerPath, fileBuffer)

	// 创建贴纸对象
	const sticker = {
		id: stickerId,
		name: metadata.name || path.basename(filename, ext),
		url: `/uploads/stickers/${packId}/${uniqueFilename}`,
		tags: metadata.tags || [],
		animated: ext.toLowerCase() === '.gif'
	}

	// 更新贴纸包配置
	pack.stickers.push(sticker)
	pack.updatedAt = Date.now()
	await saveJsonFile(getPackConfigPath(packId), pack)

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

	// 找到贴纸
	const sticker = pack.stickers.find(s => s.id === stickerId)
	if (!sticker) 
		throw new Error('Sticker not found')
	

	// 删除文件
	const stickerPath = path.join(process.cwd(), 'data', sticker.url.replace(/^\//, ''))
	if (fs.existsSync(stickerPath)) 
		fs.unlinkSync(stickerPath)
	

	// 从配置中移除
	pack.stickers = pack.stickers.filter(s => s.id !== stickerId)
	pack.updatedAt = Date.now()
	await saveJsonFile(getPackConfigPath(packId), pack)
}

/**
 * 获取用户贴纸收藏
 * @param {string} username - 用户名
 * @returns {Promise<UserStickerCollection>} 用户贴纸收藏数据
 */
export async function getUserCollection(username) {
	const collectionPath = getUserCollectionPath(username)

	if (!fs.existsSync(collectionPath)) {
		const defaultCollection = {
			username,
			installedPacks: [],
			favoriteStickers: [],
			recentStickers: []
		}
		const userDir = path.dirname(collectionPath)
		if (!fs.existsSync(userDir)) 
			fs.mkdirSync(userDir, { recursive: true })
		
		await saveJsonFile(collectionPath, defaultCollection)
		return defaultCollection
	}

	return await loadJsonFile(collectionPath)
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
	await saveJsonFile(getUserCollectionPath(username), collection)
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
	await saveJsonFile(getUserCollectionPath(username), collection)
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
		await saveJsonFile(getUserCollectionPath(username), collection)
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
	await saveJsonFile(getUserCollectionPath(username), collection)
}

/**
 * 记录最近使用
 * @param {string} username - 用户名
 * @param {string} stickerId - 贴纸ID
 * @returns {Promise<void>} 无返回值
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
	

	await saveJsonFile(getUserCollectionPath(username), collection)
}
