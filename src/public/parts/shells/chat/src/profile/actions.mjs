/**
 * Chat profile CLI actions（委托 scripts/p2p/entity）。
 */
import { getOperatorEntityHash } from '../entity/identity.mjs'
import { normalizeLocalizedMap } from '../entity/presentation.mjs'
import {
	getProfile,
	updateProfile,
	updateStatus as setEntityStatus,
} from '../entity/profile.mjs'

/**
 *
 */
export const actions = {
	/**
	 * @param {object} params 参数
	 * @param {string} params.user replica 登录名
	 * @returns {Promise<string>} JSON 文本
	 */
	async get({ user }) {
		const entityHash = await getOperatorEntityHash(user)
		const profile = await getProfile(entityHash, user)
		return JSON.stringify(profile, null, 2)
	},

	/**
	 * @param {object} params 参数
	 * @param {string} params.user replica 登录名
	 * @param {string} params.name 显示名称
	 * @param {string} [params.locale] locale 键
	 * @returns {Promise<string>} 结果消息
	 */
	async updateDisplayName({ user, name, locale = 'zh-CN' }) {
		const entityHash = await getOperatorEntityHash(user)
		const profile = await getProfile(entityHash, user, { skipPresentation: true })
		const localized = normalizeLocalizedMap(profile.localized)
		localized[locale] = { ...localized[locale], name: String(name || '').trim() }
		await updateProfile(user, entityHash, { localized })
		return `Display name updated to: ${name}`
	},

	/**
	 * @param {object} params 参数
	 * @param {string} params.user replica 登录名
	 * @param {string} params.description 个人简介
	 * @param {string} [params.locale] locale 键
	 * @returns {Promise<string>} 结果消息
	 */
	async updateBio({ user, description, locale = 'zh-CN' }) {
		const entityHash = await getOperatorEntityHash(user)
		const profile = await getProfile(entityHash, user, { skipPresentation: true })
		const localized = normalizeLocalizedMap(profile.localized)
		localized[locale] = { ...localized[locale], description: String(description || '') }
		await updateProfile(user, entityHash, { localized })
		return 'Description updated'
	},

	/**
	 * @param {object} params 参数
	 * @param {string} params.user replica 登录名
	 * @param {string} params.status 状态
	 * @param {string} [params.customStatus] 自定义状态
	 * @returns {Promise<string>} 结果消息
	 */
	async updateStatus({ user, status, customStatus = '' }) {
		const entityHash = await getOperatorEntityHash(user)
		await setEntityStatus(user, entityHash, status, customStatus)
		return `Status updated to: ${status}`
	},
}
