import { getPartList } from '../../../../server/managers/index.mjs'
import { setDefaultPart } from '../../../../server/parts_loader.mjs'
import { unlockAchievement } from '../../achievements/src/api.mjs'

import { addAISourceFile, deleteAISourceFile, getAISourceFile, saveAISourceFile } from './manager.mjs'

/**
 * AI源管理操作
 */
export const actions = {
	/**
	 * 列出AI源。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @returns {Promise<Array<string>>} - AI源列表。
	 */
	list: ({ user }) => getPartList(user, 'AIsources'),
	/**
	 * 创建AI源。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.sourceName - AI源名称。
	 * @returns {Promise<string>} - 创建成功消息。
	 */
	create: async ({ user, sourceName }) => {
		if (!sourceName) throw new Error('AI source name is required for create action.')
		await addAISourceFile(user, sourceName)
		return `AI source '${sourceName}' created.`
	},
	/**
	 * 删除AI源。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.sourceName - AI源名称。
	 * @returns {Promise<string>} - 删除成功消息。
	 */
	delete: async ({ user, sourceName }) => {
		if (!sourceName) throw new Error('AI source name is required for delete action.')
		await deleteAISourceFile(user, sourceName)
		return `AI source '${sourceName}' deleted.`
	},
	/**
	 * 获取AI源。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.sourceName - AI源名称。
	 * @returns {Promise<object>} - AI源配置。
	 */
	get: ({ user, sourceName }) => {
		if (!sourceName) throw new Error('AI source name is required for get action.')
		return getAISourceFile(user, sourceName)
	},
	/**
	 * 设置AI源。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.sourceName - AI源名称。
	 * @param {object} root0.config - 配置。
	 * @returns {Promise<string>} - 设置成功消息。
	 */
	set: async ({ user, sourceName, config }) => {
		if (!sourceName) throw new Error('AI source name is required for set action.')
		await saveAISourceFile(user, sourceName, config)
		return `AI source '${sourceName}' updated.`
	},
	/**
	 * 设置默认AI源。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.sourceName - AI源名称。
	 * @returns {Promise<string>} - 设置成功消息。
	 */
	'set-default': async ({ user, sourceName }) => {
		if (!sourceName) throw new Error('AI source name is required for set-default action.')
		await setDefaultPart(user, 'AIsources', sourceName)
		unlockAchievement(user, 'shells', 'AIsourceManage', 'set_default_aisource')
		return `AI source '${sourceName}' set as default.`
	}
}
