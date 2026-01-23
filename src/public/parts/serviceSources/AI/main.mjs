import fs from 'node:fs'

import { getUserDictionary } from '../../../../server/auth.mjs'
import { loadPartBase, unloadPartBase } from '../../../../server/parts_loader.mjs'

import info from './info.json' with { type: 'json' }

/**
 * 获取 AI 服务源路径。
 * @param {string} username - 用户名。
 * @param {string} partname - 部件名称。
 * @returns {string} 服务源路径。
 */
function GetPath(username, partname) {
	return getUserDictionary(username) + '/serviceSources/AI/' + partname
}

/**
 * 加载 AI 服务生成器。
 * @param {string} username - 用户名。
 * @param {string} AIsourcename - AI 服务源名称。
 * @returns {Promise<any>} 加载的生成器实例。
 */
function loadAIsourceGenerator(username, AIsourcename) {
	return loadPartBase(username, `serviceGenerators/AI/${AIsourcename}`)
}

/**
 * 从配置数据加载 AI 服务源。
 * @param {string} username - 用户名。
 * @param {any} data - 配置数据。
 * @param {object} root0 - 选项对象。
 * @param {Function} root0.SaveConfig - 保存配置的回调函数。
 * @returns {Promise<any>} 加载的服务源实例。
 */
async function loadAIsourceFromConfigData(username, data, { SaveConfig }) {
	const generator = await loadAIsourceGenerator(username, data?.generator || 'empty', 'serviceGenerators/AI').catch(e => {
		console.error(e)
		return loadAIsourceGenerator(username, 'empty')
	})
	return await generator.interfaces.serviceGenerator.GetSource(data?.config, {
		username,
		SaveConfig
	})
}

/**
 * 从名称或配置数据加载 AI 服务源。
 * @param {string} username - 用户名。
 * @param {string|object} source - 服务源名称或配置对象。
 * @param {any[]} unnamedSources - 未命名服务源列表。
 * @param {object} options - 加载选项。
 * @returns {Promise<any>} 加载的服务源实例。
 */
export async function loadAIsourceFromNameOrConfigData(username, source, unnamedSources, options) {
	if (Object(source) instanceof String) return loadPartBase(username, 'serviceSources/AI/' + source)
	const instance = await loadAIsourceFromConfigData(username, source, options)
	unnamedSources?.push(instance)
	return instance
}

/**
 * 标记一个错误对象表示源已死亡（如 API key 非法）。
 * @param {Error} err - 错误对象。
 * @returns {Error} 修改后的错误对象。
 */
export function source_dead(err) {
	err.source_dead = true
	return err
}

/**
 * AI 服务源部件。
 */
export default {
	info,
	/**
	 * 加载部件。
	 * @returns {Promise<void>}
	 */
	Load: async () => { },
	/**
	 * 卸载部件。
	 * @returns {Promise<void>}
	 */
	Unload: async () => { },
	interfaces: {
		parts: {
			/**
			 * 获取子部件列表。
			 * @param {string[]} my_paths - 搜索路径列表。
			 * @returns {string[]} 子部件名称列表。
			 */
			getSubPartsList: (my_paths) => {
				const names = new Set()
				for (const base of my_paths) {
					if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) continue
					for (const dirent of fs.readdirSync(base, { withFileTypes: true })) {
						if (!dirent.isDirectory()) continue
						const subPath = base + '/' + dirent.name
						if (fs.existsSync(subPath + '/main.mjs') && fs.existsSync(subPath + '/fount.json'))
							names.add(dirent.name)
					}
				}
				return [...names]
			},
			/**
			 * 获取子部件安装路径。
			 * @param {string[]} my_paths - 搜索路径列表。
			 * @returns {string[]} 子部件安装路径列表。
			 */
			getSubPartsInstallPaths: (my_paths) => my_paths,
			/**
			 * 加载子部件。
			 * @param {string[]} my_paths - 搜索路径列表。
			 * @param {string} username - 用户名。
			 * @param {string} partname - 部件名称。
			 * @returns {Promise<any>} 加载的部件实例。
			 */
			loadSubPart: (my_paths, username, partname) =>
				loadPartBase(username, 'serviceSources/AI/' + partname, { username }),
			/**
			 * 卸载子部件。
			 * @param {string[]} my_paths - 搜索路径列表。
			 * @param {string} username - 用户名。
			 * @param {string} partname - 部件名称。
			 * @param {string} reason - 卸载原因。
			 * @returns {Promise<void>}
			 */
			unloadSubPart: async (my_paths, username, partname, reason) => {
				return unloadPartBase(username, 'serviceSources/AI/' + partname, {}, {
					/**
					 * 获取路径的回调。
					 * @returns {string} 路径。
					 */
					pathGetter: () => GetPath(username, partname),
					/**
					 * 卸载后的回调。
					 * @param {any} _ - 参数。
					 * @returns {number} 结果。
					 */
					afterUnload: _ => 0
				})
			}
		},
		serviceSourceType: {
			loadFromConfigData: loadAIsourceFromConfigData
		}
	}
}
