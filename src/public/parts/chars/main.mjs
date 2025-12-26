import fs from 'node:fs'
import path from 'node:path'

import { loadPartBase, unloadPartBase } from '../../../server/parts_loader.mjs'
import { loadData, saveData } from '../../../server/setting_loader.mjs'

import info from './info.json' with { type: 'json' }

/**
 * 为用户加载角色数据。
 * @param {string} username - 用户的用户名。
 * @param {string} charname - 角色的名称。
 * @returns {object} 角色数据。
 */
function loadCharData(username, charname) {
	const userCharDataSet = loadData(username, 'char_data')
	return userCharDataSet[charname] ??= {
		state: {
			init_count: 0,
			last_start_time_stamp: 0,
			start_count: 0,
		}
	}
}
/**
 * 为用户保存角色数据。
 * @param {string} username - 用户的用户名。
 * @returns {void}
 */
function saveCharData(username) {
	saveData(username, 'char_data')
}

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
			loadSubPart: async (my_paths, username, partname) => {
				const data = loadCharData(username, partname)
				const char_state = data.state
				return loadPartBase(username, 'chars/' + partname, {
					username,
					charname: partname,
					state: char_state,
				}, {
					/**
					 * 加载后的回调。
					 */
					afterLoad: () => {
						char_state.last_start_time_stamp = Date.now()
						char_state.start_count++
					}
				})
			},
			/**
			 * 卸载子部件。
			 * @param {string[]} my_paths - 搜索路径列表。
			 * @param {string} username - 用户名。
			 * @param {string} partname - 部件名称。
			 * @param {string} reason - 卸载原因。
			 * @returns {Promise<void>}
			 */
			unloadSubPart: async (my_paths, username, partname, reason) => {
				await unloadPartBase(username, 'chars/' + partname, reason)
				saveCharData(username)
			}
		}
	}
}
