import { getPartList, setDefaultPart } from '../../../../../server/parts_loader.mjs'
import { unlockAchievement } from '../../achievements/src/api.mjs'

import { addServiceSourceFile, deleteServiceSourceFile, getServiceSourceFile, saveServiceSourceFile } from './manager.mjs'

/**
 * 根据类型自动推断服务源路径。
 * @param {string} type - 服务源类型（如 'AI', 'Storage' 等）。
 * @returns {string} - 推断的服务源路径。
 */
function inferServiceSourcePath(type = 'AI') {
	return `serviceSources/${type}`
}

/**
 * 定义了服务源管理的可用操作。
 */
export const actions = {
	/**
	 * 列出指定用户的服务源。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户名。
	 * @param {string} root0.type - 服务源类型（如 'AI'），默认为 'AI'。
	 * @returns {Promise<Array<string>>} - 返回一个包含服务源名称的数组。
	 */
	list: ({ user, type = 'AI' }) => {
		const serviceSourcePath = inferServiceSourcePath(type)
		return getPartList(user, serviceSourcePath)
	},
	/**
	 * 为指定用户创建一个新的服务源。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户名。
	 * @param {string} root0.sourceName - 要创建的服务源的名称。
	 * @param {string} root0.type - 服务源类型（如 'AI'），默认为 'AI'。
	 * @param {string} root0.generator - 生成器名称（可选）。
	 * @returns {Promise<string>} - 返回一个确认消息。
	 */
	create: async ({ user, sourceName, type = 'AI', generator }) => {
		if (!sourceName) throw new Error('Service source name is required for create action.')
		const serviceSourcePath = inferServiceSourcePath(type)
		await addServiceSourceFile(user, sourceName, serviceSourcePath)
		if (generator) {
			// 如果提供了生成器，自动设置配置
			const data = await getServiceSourceFile(user, sourceName, serviceSourcePath)
			data.generator = generator
			await saveServiceSourceFile(user, sourceName, data, serviceSourcePath)
		}
		return `Service source '${sourceName}' created${generator ? ` with generator '${generator}'` : ''}.`
	},
	/**
	 * 删除指定用户的服务源。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户名。
	 * @param {string} root0.sourceName - 要删除的服务源的名称。
	 * @param {string} root0.type - 服务源类型（如 'AI'），默认为 'AI'。
	 * @returns {Promise<string>} - 返回一个确认消息。
	 */
	delete: async ({ user, sourceName, type = 'AI' }) => {
		if (!sourceName) throw new Error('Service source name is required for delete action.')
		const serviceSourcePath = inferServiceSourcePath(type)
		await deleteServiceSourceFile(user, sourceName, serviceSourcePath)
		return `Service source '${sourceName}' deleted.`
	},
	/**
	 * 获取指定用户的服务源配置。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户名。
	 * @param {string} root0.sourceName - 要获取的服务源的名称。
	 * @param {string} root0.type - 服务源类型（如 'AI'），默认为 'AI'。
	 * @returns {Promise<object>} - 返回服务源的配置对象。
	 */
	get: ({ user, sourceName, type = 'AI' }) => {
		if (!sourceName) throw new Error('Service source name is required for get action.')
		const serviceSourcePath = inferServiceSourcePath(type)
		return getServiceSourceFile(user, sourceName, serviceSourcePath)
	},
	/**
	 * 设置或更新指定用户的服务源配置。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户名。
	 * @param {string} root0.sourceName - 要设置的服务源的名称。
	 * @param {object} root0.config - 新的配置对象（可选，如果提供则合并到现有配置）。
	 * @param {string} root0.type - 服务源类型（如 'AI'），默认为 'AI'。
	 * @returns {Promise<string>} - 返回一个确认消息。
	 */
	set: async ({ user, sourceName, config, type = 'AI' }) => {
		if (!sourceName) throw new Error('Service source name is required for set action.')
		const serviceSourcePath = inferServiceSourcePath(type)
		let data = await getServiceSourceFile(user, sourceName, serviceSourcePath)
		if (config)
			// 合并配置
			data = { ...data, config: { ...data.config, ...config } }

		await saveServiceSourceFile(user, sourceName, data, serviceSourcePath)
		return `Service source '${sourceName}' updated.`
	},
	/**
	 * 将指定的服务源设置为用户的默认源。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户名。
	 * @param {string} root0.sourceName - 要设置为默认的服务源的名称。
	 * @param {string} root0.type - 服务源类型（如 'AI'），默认为 'AI'。
	 * @returns {Promise<string>} - 返回一个确认消息。
	 */
	'set-default': async ({ user, sourceName, type = 'AI' }) => {
		if (!sourceName) throw new Error('Service source name is required for set-default action.')
		const serviceSourcePath = inferServiceSourcePath(type)
		await setDefaultPart(user, serviceSourcePath, sourceName)
		unlockAchievement(user, 'shells/serviceSourceManage', 'set_default_aisource')
		return `Service source '${sourceName}' set as default.`
	}
}
