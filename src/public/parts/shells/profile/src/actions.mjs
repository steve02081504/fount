import {
	getProfile,
	updateProfile,
	updateStatus
} from './profile.mjs'

/**
 * 个人资料操作
 */
export const actions = {
	/**
	 * 获取用户资料
	 * @param {object} params - 参数
	 * @param {string} params.user - 用户名
	 * @returns {Promise<string>}
	 */
	async get({ user }) {
		const profile = await getProfile(user)
		return JSON.stringify(profile, null, 2)
	},

	/**
	 * 更新显示名称
	 * @param {object} params - 参数
	 * @param {string} params.user - 用户名
	 * @param {string} params.displayName - 显示名称
	 * @returns {Promise<string>}
	 */
	async updateDisplayName({ user, displayName }) {
		await updateProfile(user, { displayName })
		return `Display name updated to: ${displayName}`
	},

	/**
	 * 更新个人简介
	 * @param {object} params - 参数
	 * @param {string} params.user - 用户名
	 * @param {string} params.bio - 个人简介
	 * @returns {Promise<string>}
	 */
	async updateBio({ user, bio }) {
		await updateProfile(user, { bio })
		return 'Bio updated'
	},

	/**
	 * 更新状态
	 * @param {object} params - 参数
	 * @param {string} params.user - 用户名
	 * @param {string} params.status - 状态
	 * @param {string} params.customStatus - 自定义状态
	 * @returns {Promise<string>}
	 */
	async updateStatus({ user, status, customStatus = '' }) {
		await updateStatus(user, status, customStatus)
		return `Status updated to: ${status}`
	},

	/**
	 * 更新偏好设置
	 * @param {object} params - 参数
	 * @param {string} params.user - 用户名
	 * @param {string} params.language - 语言
	 * @param {string} params.theme - 主题
	 * @returns {Promise<string>}
	 */
	async updatePreferences({ user, language, theme }) {
		const updates = {}
		if (language) updates.language = language
		if (theme) updates.theme = theme

		await updateProfile(user, {
			preferences: updates
		})
		return 'Preferences updated'
	}
}
