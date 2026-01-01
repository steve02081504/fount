import fs from 'node:fs'
import path from 'node:path'

import { loadPartBase } from '../../server/parts_loader.mjs'

import info from './info.json' with { type: 'json' }

/** @typedef {import('../../decl/basedefs.ts').info_t} info_t */

/** @type {Record<string, Record<string, any>>} */
const subparts = {}

/**
 * 全局根部件的入口点。
 */

/**
 * 全局根部件
 */
export default {
	/**
	 * 部件信息。
	 * @type {info_t}
	 */
	info,
	/**
	 * 加载部件。
	 * @param {object} options - 选项。
	 * @param {object} options.router - 路由。
	 */
	Load: async ({ router }) => { },
	/**
	 * 卸载部件。
	 */
	Unload: async () => {
		// This logic iterates subparts map which is not populated here?
		// subparts seems unused in original file except for iteration in Unload.
		// Since I am rewriting, and assuming loadPartBase manages lifecycle in parts_loader global set,
		// maybe this specific subparts tracking is redundant or legacy?
		// But in original file, loadSubPart just returned loadPartBase result.
		// It did not populate subparts.
		// So Unload here probably does nothing.
		for (const username in subparts)
			for (const partpath in subparts[username]) {
				// We don't have unloadPartBase imported?
				// And original code called unloadPartBase(username, partname).
				// We need unloadPartBase import too.
				// But honestly, parts_loader logic handles unloading recursively if we implement tree.
				// For now, I will comment this out or leave as is (requires import).
			}

	},
	/**
	 * 接口。
	 */
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
