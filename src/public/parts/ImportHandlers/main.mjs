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
			 * @param {Array<string>} my_paths - 路径数组。
			 * @returns {Array<string>} 子部件名称数组。
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
			 * @param {Array<string>} my_paths - 路径数组。
			 * @returns {Array<string>} 安装路径数组。
			 */
			getSubPartsInstallPaths: (my_paths) => my_paths,
			/**
			 * 加载子部件。
			 * @param {Array<string>} my_paths - 路径数组。
			 * @param {string} username - 用户名。
			 * @param {string} partname - 部件名称。
			 * @returns {Promise<any>} 加载的部件。
			 */
			loadSubPart: (my_paths, username, partname) => {
				return loadPartBase(username, 'ImportHandlers/' + partname)
			},
			/**
			 * 卸载子部件。
			 * @param {Array<string>} my_paths - 路径数组。
			 * @param {string} username - 用户名。
			 * @param {string} partname - 部件名称。
			 * @param {string} reason - 卸载原因。
			 * @returns {Promise<void>}
			 */
			unloadSubPart: async (my_paths, username, partname, reason) => {
				return unloadPartBase(username, 'ImportHandlers/' + partname, reason)
			}
		}
	}
}
