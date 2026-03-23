import path from 'node:path'

import { setPartData } from '../../../../../../src/public/parts/shells/config/src/manager.mjs'
import { loadJsonFileIfExists, saveJsonFile } from '../../../../../../src/scripts/json_loader.mjs'
import { loadPart } from '../../../../../../src/server/parts_loader.mjs'

const configPath = import.meta.dirname + '/config.json'
const data = loadJsonFileIfExists(configPath, { generator: '', config: {} })

let username = ''
const filename = path.basename(import.meta.dirname)

/**
 * 服务源模块。
 */
const self = {
	filename,
	/**
	 * 加载服务源。
	 * @param {object} initialData - 初始化参数对象。
	 * @param {string} initialData.username - 用户名。
	 * @returns {Promise<void>}
	 */
	async Load(initialData) {
		username = initialData.username
		const manager = await loadPart(username, 'serviceSources/search')
		Object.assign(this, await manager.interfaces.serviceSourceType.loadFromConfigData(username, data, {
			/**
			 * 将当前配置保存到部件数据。
			 * @returns {void}
			 */
			SaveConfig: () => setPartData(username, `serviceSources/search/${filename}`, data)
		}))
		Object.assign(this.interfaces, defaultInterfaces)
	},
}
const defaultInterfaces = self.interfaces = {
	config: {
		/**
		 * 获取配置数据。
		 * @returns {Promise<any>} - 配置数据。
		 */
		async GetData() {
			return data
		},
		/**
		 * 设置配置数据。
		 * @param {any} new_data - 要设置的新配置数据。
		 * @returns {Promise<void>}
		 */
		async SetData(new_data) {
			if (new_data !== data) {
				if (new_data.generator) data.generator = new_data.generator
				if (new_data.config) { // 保持config对象不变，确保saveConfig有效
					for (const key in data.config ??= {}) delete data.config[key]
					Object.assign(data.config, new_data.config)
				}
				await self.Load({ username })
			}
			saveJsonFile(configPath, data)
		}
	}
}

/**
 * 服务源模块。
 */
export default self
