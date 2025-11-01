import { getPartList } from '../../../../server/managers/index.mjs'
import { setDefaultPart } from '../../../../server/parts_loader.mjs'
import { unlockAchievement } from '../../achievements/src/api.mjs'

import { addAISourceFile, deleteAISourceFile, getAISourceFile, saveAISourceFile } from './manager.mjs'

/**
 * 定义了AI源管理的可用操作。
 */
export const actions = {
	/**
	 * 列出指定用户的AI源。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户名。
	 * @returns {Promise<Array<string>>} - 返回一个包含AI源名称的数组。
	 */
	list: ({ user }) => getPartList(user, 'AIsources'),
	/**
	 * 为指定用户创建一个新的AI源。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户名。
	 * @param {string} root0.sourceName - 要创建的AI源的名称。
	 * @returns {Promise<string>} - 返回一个确认消息。
	 */
	create: async ({ user, sourceName }) => {
		if (!sourceName) throw new Error('AI source name is required for create action.')
		await addAISourceFile(user, sourceName)
		return `AI source '${sourceName}' created.`
	},
	/**
	 * 删除指定用户的AI源。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户名。
	 * @param {string} root0.sourceName - 要删除的AI源的名称。
	 * @returns {Promise<string>} - 返回一个确认消息。
	 */
	delete: async ({ user, sourceName }) => {
		if (!sourceName) throw new Error('AI source name is required for delete action.')
		await deleteAISourceFile(user, sourceName)
		return `AI source '${sourceName}' deleted.`
	},
	/**
	 * 获取指定用户的AI源配置。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户名。
	 * @param {string} root0.sourceName - 要获取的AI源的名称。
	 * @returns {Promise<object>} - 返回AI源的配置对象。
	 */
	get: ({ user, sourceName }) => {
		if (!sourceName) throw new Error('AI source name is required for get action.')
		return getAISourceFile(user, sourceName)
	},
	/**
	 * 设置或更新指定用户的AI源配置。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户名。
	 * @param {string} root0.sourceName - 要设置的AI源的名称。
	 * @param {object} root0.config - 新的配置对象。
	 * @returns {Promise<string>} - 返回一个确认消息。
	 */
	set: async ({ user, sourceName, config }) => {
		if (!sourceName) throw new Error('AI source name is required for set action.')
		await saveAISourceFile(user, sourceName, config)
		return `AI source '${sourceName}' updated.`
	},
	/**
	 * 将指定的AI源设置为用户的默认源。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户名。
	 * @param {string} root0.sourceName - 要设置为默认的AI源的名称。
	 * @returns {Promise<string>} - 返回一个确认消息。
	 */
	'set-default': async ({ user, sourceName }) => {
		if (!sourceName) throw new Error('AI source name is required for set-default action.')
		await setDefaultPart(user, 'AIsources', sourceName)
		unlockAchievement(user, 'shells', 'AIsourceManage', 'set_default_aisource')
		return `AI source '${sourceName}' set as default.`
	}
}
