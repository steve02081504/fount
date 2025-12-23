import fs from 'node:fs'
import path from 'node:path'

import { loadPartBase, unloadPartBase } from '../../../server/parts_loader.mjs'

import info from './info.json' with { type: 'json' }

/**
 *
 */
export default {
	info,
	/**
	 *
	 */
	Load: async () => { },
	/**
	 *
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
				return [...new Set(my_paths.map(p => {
					if (fs.existsSync(p))
						return fs.readdirSync(p).filter(part =>
							fs.existsSync(path.join(p, part, 'main.mjs'))
						)

					return []
				}).flat())]
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
			loadSubPart: (my_paths, username, partname) => {
				// 尝试加载为搜索生成器
				if (partname.startsWith('search/')) 
					return loadPartBase(username, 'serviceGenerators/' + partname, {}, { skipParentDelegation: true })
				
				// 尝试加载为 AI 生成器
				if (partname.startsWith('AI/')) 
					return loadPartBase(username, 'serviceGenerators/' + partname, {}, { skipParentDelegation: true })
				
				// 默认加载为插件
				return loadPartBase(username, 'plugins/' + partname, {}, { skipParentDelegation: true })
			},
			/**
			 * 卸载子部件。
			 * @param {string[]} my_paths - 搜索路径列表。
			 * @param {string} username - 用户名。
			 * @param {string} partname - 部件名称。
			 * @returns {Promise<void>}
			 */
			unloadSubPart: async (my_paths, username, partname) => {
				// 尝试卸载为搜索生成器
				if (partname.startsWith('search/')) 
					return unloadPartBase(username, 'serviceGenerators/' + partname, {}, { skipParentDelegation: true })
				
				// 尝试卸载为 AI 生成器
				if (partname.startsWith('AI/')) 
					return unloadPartBase(username, 'serviceGenerators/' + partname, {}, { skipParentDelegation: true })
				
				// 默认卸载为插件
				return unloadPartBase(username, 'plugins/' + partname, {}, { skipParentDelegation: true })
			}
		}
	}
}
