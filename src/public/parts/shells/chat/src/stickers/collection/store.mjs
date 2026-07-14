/**
 * 【文件】stickers/collection/store.mjs
 * 【职责】用户贴纸收藏（已安装包、收藏夹、最近使用）在 shellData 中的读写与默认值初始化。
 * 【原理】loadShellData(username,'chat','sticker_collection')；缺失时 assignShellData 写入空集合并返回；save 全量覆盖。
 * 【数据结构】UserStickerCollection：entityHash、installedPacks、favoriteStickers、recentStickers。
 * 【关联】被 collection/index.mjs、stickers.mjs 使用；依赖 server/setting_loader、chatAuxAPI 类型。
 */
import { assignShellData, loadShellData } from '../../../../../../../server/setting_loader.mjs'

/** @typedef {import('../../../decl/chatAuxAPI.ts').UserStickerCollection} UserStickerCollection */

const SHELL_DATANAME = 'sticker_collection'

/**
 * 从 shellData 读取用户贴纸收藏。
 * @param {string} username 用户名
 * @returns {UserStickerCollection} 收藏数据
 */
export function loadUserStickerCollection(username) {
	const cached = loadShellData(username, 'chat', SHELL_DATANAME)
	if (cached?.installedPacks)
		return /** @type {UserStickerCollection} */ cached

	const fresh = {
		entityHash: '',
		installedPacks: [],
		favoriteStickers: [],
		recentStickers: [],
	}
	assignShellData(username, 'chat', SHELL_DATANAME, fresh)
	return fresh
}

/**
 * 持久化用户贴纸收藏到 shellData。
 * @param {string} username 用户名
 * @param {UserStickerCollection} collection 收藏数据
 * @returns {void}
 */
export function saveUserStickerCollection(username, collection) {
	assignShellData(username, 'chat', SHELL_DATANAME, collection)
}
