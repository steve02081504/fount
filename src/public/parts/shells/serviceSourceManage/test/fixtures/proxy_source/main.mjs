/**
 * 前端测试用自包含服务源：只按 `config.json` 提供 `config` 接口，
 * 不依赖会被测试节点相对路径假设破坏的脚手架 `config` 管理器。
 */
import fs from 'node:fs'

const configPath = import.meta.dirname + '/config.json'
const data = JSON.parse(fs.readFileSync(configPath, 'utf8'))

/**
 * 前端测试用服务源部件。
 */
export default {
	/**
	 * 加载服务源（测试用空实现）。
	 * @returns {Promise<void>}
	 */
	async Load() { },
	interfaces: {
		config: {
			/**
			 * 获取配置数据。
			 * @returns {Promise<object>} 配置数据。
			 */
			async GetData() {
				return data
			},
			/**
			 * 覆盖配置数据。
			 * @param {object} newData 新配置数据。
			 * @returns {Promise<void>}
			 */
			async SetData(newData) {
				Object.assign(data, newData)
				fs.writeFileSync(configPath, JSON.stringify(data, null, '\t'))
			},
		},
	},
}
