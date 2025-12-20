import fs from 'node:fs'
import path from 'node:path'

import { loadPartBase } from '../../../server/parts_loader.mjs'

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
			 * @param {string[]} my_paths - 当前部件的多个路径。
			 * @returns {Set<string>} 子部件列表。
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
			 * 获取子部件的安装文件夹路径。
			 * @param {string[]} my_paths - 当前部件的多个路径。
			 * @returns {string[]} 子部件的多个可选安装路径。
			 */
			getSubPartsInstallPaths: (my_paths) => {
				return my_paths
			},
			/**
			 * 加载子部件。
			 * @param {string[]} my_paths - 当前部件的多个路径。
			 * @param {string} username - 用户的用户名。
			 * @param {string} partname - 部件的名称。
			 * @returns {Promise<any>} 加载的部件实例。
			 */
			loadSubPart: (my_paths, username, partname) => {
				// partname passed here from parts_loader is just the name of the child.
				// Since this is root part, the path is just the name.
				return loadPartBase(username, partname)
			}
		}
	}
}
