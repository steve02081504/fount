import fs from 'node:fs'
import path from 'node:path'

import { loadPartBase, unloadPartBase } from '../../../../server/parts_loader.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 语音识别服务生成器根部件。
 */
export default {
	info,
	/**
	 * @returns {Promise<void>}
	 */
	Load: async () => { },
	/**
	 * @returns {Promise<void>}
	 */
	Unload: async () => { },
	interfaces: {
		parts: {
			/**
			 * @param {string[]} my_paths 搜索路径
			 * @returns {string[]} 子部件名
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
			 * @param {string[]} my_paths 搜索路径
			 * @returns {string[]} 安装路径
			 */
			getSubPartsInstallPaths: (my_paths) => my_paths,
			/**
			 * @param {string[]} my_paths 搜索路径
			 * @param {string} username 用户名
			 * @param {string} partname 部件名
			 * @returns {Promise<any>} 实例
			 */
			loadSubPart: (my_paths, username, partname) => {
				return loadPartBase(username, 'serviceGenerators/SpeechRecognition/' + partname)
			},
			/**
			 * @param {string[]} my_paths 搜索路径
			 * @param {string} username 用户名
			 * @param {string} partname 部件名
			 * @returns {Promise<void>}
			 */
			unloadSubPart: async (my_paths, username, partname) => {
				return unloadPartBase(username, 'serviceGenerators/SpeechRecognition/' + partname)
			}
		}
	}
}
