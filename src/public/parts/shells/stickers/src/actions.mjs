import {
	getStickerPacks,
	createStickerPack,
	getStickerPack,
	deleteStickerPack,
	installPack,
	uninstallPack
} from './stickers.mjs'

/**
 * 贴纸操作
 */
export const actions = {
	/**
	 * 列出贴纸包
	 * @param {object} params - 参数
	 * @param {string} params.user - 用户名
	 * @returns {Promise<string>}
	 */
	async list({ user }) {
		const packs = await getStickerPacks(user)
		if (packs.length === 0) {
			return 'No sticker packs found'
		}
		return packs.map(p => `${p.packId}: ${p.name} by ${p.author} (${p.stickers.length} stickers)`).join('\n')
	},

	/**
	 * 创建贴纸包
	 * @param {object} params - 参数
	 * @param {string} params.user - 用户名
	 * @param {string} params.name - 贴纸包名称
	 * @param {string} params.description - 描述
	 * @returns {Promise<string>}
	 */
	async create({ user, name, description = '' }) {
		const pack = await createStickerPack(user, { name, description })
		return `Sticker pack created: ${pack.packId}`
	},

	/**
	 * 获取贴纸包详情
	 * @param {object} params - 参数
	 * @param {string} params.packId - 贴纸包ID
	 * @returns {Promise<string>}
	 */
	async info({ packId }) {
		const pack = await getStickerPack(packId)
		return JSON.stringify(pack, null, 2)
	},

	/**
	 * 安装贴纸包
	 * @param {object} params - 参数
	 * @param {string} params.user - 用户名
	 * @param {string} params.packId - 贴纸包ID
	 * @returns {Promise<string>}
	 */
	async install({ user, packId }) {
		await installPack(user, packId)
		return `Sticker pack installed: ${packId}`
	},

	/**
	 * 卸载贴纸包
	 * @param {object} params - 参数
	 * @param {string} params.user - 用户名
	 * @param {string} params.packId - 贴纸包ID
	 * @returns {Promise<string>}
	 */
	async uninstall({ user, packId }) {
		await uninstallPack(user, packId)
		return `Sticker pack uninstalled: ${packId}`
	},

	/**
	 * 删除贴纸包
	 * @param {object} params - 参数
	 * @param {string} params.packId - 贴纸包ID
	 * @returns {Promise<string>}
	 */
	async delete({ packId }) {
		await deleteStickerPack(packId)
		return `Sticker pack deleted: ${packId}`
	}
}
