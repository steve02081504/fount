import fs from 'node:fs'

import { getUserDictionary } from '../../../../server/auth/index.mjs'
import { loadPartBase, unloadPartBase } from '../../../../server/parts_loader.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 获取语音识别服务源路径。
 * @param {string} username 用户名
 * @param {string} partname 部件名
 * @returns {string} 路径
 */
function GetPath(username, partname) {
	return getUserDictionary(username) + '/serviceSources/SpeechRecognition/' + partname
}

/**
 * 加载语音识别服务生成器。
 * @param {string} username 用户名
 * @param {string} name 生成器名
 * @returns {Promise<any>} 生成器
 */
function loadSpeechRecognitionSourceGenerator(username, name) {
	return loadPartBase(username, `serviceGenerators/SpeechRecognition/${name}`)
}

/**
 * 从配置数据加载语音识别服务源。
 * @param {string} username 用户名
 * @param {any} data 配置
 * @param {object} root0 选项
 * @param {Function} root0.SaveConfig 保存回调
 * @returns {Promise<any>} 服务源
 */
async function loadSpeechRecognitionSourceFromConfigData(username, data, { SaveConfig }) {
	const generator = await loadSpeechRecognitionSourceGenerator(username, data.generator).catch(e => {
		console.error(e)
		return loadSpeechRecognitionSourceGenerator(username, 'empty')
	})
	return await generator.interfaces.serviceGenerator.GetSource(data.config, {
		username,
		SaveConfig
	})
}

/**
 * 从名称或配置加载语音识别源。
 * @param {string} username 用户名
 * @param {string|object} source 名称或配置
 * @param {any[]} unnamedSources 未命名源列表
 * @param {object} options 选项
 * @returns {Promise<any>} 服务源
 */
export async function loadSpeechRecognitionSourceFromNameOrConfigData(username, source, unnamedSources, options) {
	if (typeof source === 'string') return loadPartBase(username, 'serviceSources/SpeechRecognition/' + source)
	const instance = await loadSpeechRecognitionSourceFromConfigData(username, source, options)
	unnamedSources?.push(instance)
	return instance
}

/**
 * 语音识别服务源类型管理器。
 */
export default {
	info,
	interfaces: {
		parts: {
			/**
			 * @param {string[]} my_paths 搜索路径
			 * @returns {string[]} 子部件名
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
			loadSubPart: (my_paths, username, partname) =>
				loadPartBase(username, 'serviceSources/SpeechRecognition/' + partname, { username }),
			/**
			 * @param {string[]} my_paths 搜索路径
			 * @param {string} username 用户名
			 * @param {string} partname 部件名
			 * @param {string} reason 原因
			 * @returns {Promise<void>}
			 */
			unloadSubPart: async (my_paths, username, partname, reason) => {
				return unloadPartBase(username, 'serviceSources/SpeechRecognition/' + partname, {}, {
					/**
					 * @returns {string} 路径
					 */
					pathGetter: () => GetPath(username, partname),
					/**
					 * 卸载后的回调。
					 * @param {any} _ 忽略
					 * @returns {number} 结果
					 */
					afterUnload: _ => 0
				})
			}
		},
		serviceSourceType: {
			loadFromConfigData: loadSpeechRecognitionSourceFromConfigData
		}
	}
}
