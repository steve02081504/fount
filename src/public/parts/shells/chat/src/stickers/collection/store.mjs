/**
 * 【文件】stickers/collection/store.mjs
 * 【职责】实体贴纸收藏（已安装包、收藏夹、最近使用）在实体私有 shellData 中的读写与默认值初始化。
 * 【原理】loadEntityShellData(username,'chat',entityHash,'sticker_collection')；缺失时写入空集合并返回；save 全量覆盖。
 * 【数据结构】UserStickerCollection：entityHash、installedPacks、favoriteStickers、recentStickers。
 * 【关联】被 collection/index.mjs、stickers.mjs 使用；依赖 server/setting_loader、chatAuxAPI 类型。
 */
import { assignEntityShellData, loadEntityShellData } from '../../../../../../../server/setting_loader.mjs'

/** @typedef {import('../../../decl/chatAuxAPI.ts').UserStickerCollection} UserStickerCollection */

const SHELL_DATANAME = 'sticker_collection'

/**
 * 从实体私有 shellData 读取贴纸收藏。
 * @param {string} username 用户名
 * @param {string} entityHash 实体
 * @returns {UserStickerCollection} 收藏数据
 */
export function loadUserStickerCollection(username, entityHash) {
	const hash = String(entityHash || '').trim().toLowerCase()
	const cached = loadEntityShellData(username, 'chat', hash, SHELL_DATANAME)
	if (cached?.installedPacks)
		return /** @type {UserStickerCollection} */ cached

	const fresh = {
		entityHash: hash,
		installedPacks: [],
		favoriteStickers: [],
		recentStickers: [],
	}
	assignEntityShellData(username, 'chat', hash, SHELL_DATANAME, fresh)
	return fresh
}

/**
 * 持久化实体贴纸收藏。
 * @param {string} username 用户名
 * @param {string} entityHash 实体
 * @param {UserStickerCollection} collection 收藏数据
 * @returns {void}
 */
export function saveUserStickerCollection(username, entityHash, collection) {
	const hash = String(entityHash || '').trim().toLowerCase()
	assignEntityShellData(username, 'chat', hash, SHELL_DATANAME, {
		...collection,
		entityHash: hash,
	})
}
