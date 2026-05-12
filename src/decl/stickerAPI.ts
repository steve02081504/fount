import { info_t } from './basedefs.ts'

/**
 * 贴纸接口
 */
export interface Sticker {
	id: string
	name: string
	url: string
	tags: string[]
	animated: boolean
}

/**
 * 贴纸包接口
 */
export interface StickerPack {
	packId: string
	name: string
	author: string
	description: string
	thumbnail?: string
	stickers: Sticker[]
	isPublic: boolean
	createdAt: number
	updatedAt: number
}

/**
 * 用户贴纸收藏接口
 */
export interface UserStickerCollection {
	username: string
	installedPacks: string[]
	favoriteStickers: string[]
	recentStickers: string[]
}

/**
 * 贴纸消息类型
 */
export interface StickerMessage {
	type: 'sticker'
	packId: string
	stickerId: string
	url: string
}

/**
 * Sticker API 接口
 */
export class StickerAPI_t {
	info: info_t

	Init?: () => Promise<void>
	Load?: () => Promise<void>
	Unload?: (reason: string) => Promise<void>

	interfaces?: {
		/**
		 * 获取贴纸包列表
		 */
		getStickerPacks?: (username?: string) => Promise<StickerPack[]>

		/**
		 * 创建贴纸包
		 */
		createStickerPack?: (username: string, pack: Partial<StickerPack>) => Promise<StickerPack>

		/**
		 * 获取贴纸包详情
		 */
		getStickerPack?: (packId: string) => Promise<StickerPack>

		/**
		 * 更新贴纸包
		 */
		updateStickerPack?: (packId: string, updates: Partial<StickerPack>) => Promise<StickerPack>

		/**
		 * 删除贴纸包
		 */
		deleteStickerPack?: (packId: string) => Promise<void>

		/**
		 * 上传贴纸
		 */
		uploadSticker?: (packId: string, file: Buffer, filename: string, metadata: Partial<Sticker>) => Promise<Sticker>

		/**
		 * 删除贴纸
		 */
		deleteSticker?: (packId: string, stickerId: string) => Promise<void>

		/**
		 * 安装贴纸包
		 */
		installPack?: (username: string, packId: string) => Promise<void>

		/**
		 * 卸载贴纸包
		 */
		uninstallPack?: (username: string, packId: string) => Promise<void>

		/**
		 * 获取用户贴纸收藏
		 */
		getUserCollection?: (username: string) => Promise<UserStickerCollection>

		/**
		 * 添加到收藏
		 */
		addToFavorites?: (username: string, stickerId: string) => Promise<void>

		/**
		 * 从收藏移除
		 */
		removeFromFavorites?: (username: string, stickerId: string) => Promise<void>

		/**
		 * 记录最近使用
		 */
		recordRecentUse?: (username: string, stickerId: string) => Promise<void>
	}
}
