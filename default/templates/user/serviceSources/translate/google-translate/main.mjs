import path from 'node:path'

import { setPartData } from '../../../../../../src/public/parts/shells/config/src/manager.mjs'
import { loadJsonFile, saveJsonFile } from '../../../../../../src/scripts/json_loader.mjs'
import { loadPart } from '../../../../../../src/server/parts_loader.mjs'

const configPath = import.meta.dirname + '/config.json'
const data = loadJsonFile(configPath)
const defaultInterfaces = {
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
			}
			saveJsonFile(configPath, data)
		},
		/**
		 * 获取配置显示内容。
		 * @returns {Promise<{ html: string, js: string }>} - 显示内容。
		 */
		async GetConfigDisplayContent() {
			return { html: '', js: '' }
		}
	}
}

const my_name = path.basename(import.meta.dirname)

/**
 * 翻译服务源模块。
 */
export default {
	filename: my_name,
	/**
	 * 加载翻译服务源。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.username - 用户名。
	 * @returns {Promise<void>}
	 */
	async Load({ username }) {
		const manager = await loadPart(username, 'serviceSources/translate')
		Object.assign(this, await manager.interfaces.serviceSourceType.loadFromConfigData(username, data, {
			/**
			 * 将当前配置保存到部件数据。
			 * @returns {void}
			 */
			SaveConfig: () => setPartData(username, `serviceSources/translate/${my_name}`, data)
		}))
		Object.assign(this.interfaces, defaultInterfaces)
	},
	interfaces: defaultInterfaces
}
