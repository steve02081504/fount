import { loadJsonFile, saveJsonFile } from '../../scripts/json_loader.mjs'
import { getUserDictionary } from '../auth.mjs'
import { getAnyDefaultPart, isPartLoaded, loadPartBase, unloadPartBase } from '../parts_loader.mjs'
import { skip_report } from '../server.mjs'

/**
 * 获取给定 AI 源的路径。
 * @param {string} username - 用户的用户名。
 * @param {string} partname - AI 源的名称。
 * @returns {string} AI 源的路径。
 */
function GetPath(username, partname) {
	return getUserDictionary(username) + '/AIsources/' + partname
}

/**
 * 加载 AI 源生成器。
 * @param {string} username - 用户的用户名。
 * @param {string} AIsourcename - AI 源生成器的名称。
 * @returns {Promise<import('../../decl/AIsourceGenerator.ts').AIsourceGenerator_t>} 一个解析为已加载 AI 源生成器的承诺。
 */
export async function loadAIsourceGenerator(username, AIsourcename) {
	return loadPartBase(username, 'AIsourceGenerators', AIsourcename)
}

/**
 * 卸载 AI 源生成器。
 * @param {string} username - 用户的用户名。
 * @param {string} AIsourcename - AI 源生成器的名称。
 * @returns {Promise<void>} 一个在 AI 源生成器卸载后解析的承诺。
 */
export async function unloadAIsourceGenerator(username, AIsourcename) {
	await unloadPartBase(username, 'AIsourceGenerators', AIsourcename)
}

/**
 * 从配置数据加载 AI 源。
 * @param {string} username - 用户的用户名。
 * @param {object} data - AI 源的配置数据。
 * @param {object} options - 加载 AI 源的选项。
 * @param {Function} options.SaveConfig - 保存配置数据的函数。
 * @returns {Promise<any>} 一个解析为已加载 AI 源的承诺。
 */
export async function loadAIsourceFromConfigData(username, data, { SaveConfig }) {
	const generator = await loadAIsourceGenerator(username, data.generator).catch(() => loadAIsourceGenerator(username, 'empty'))
	return await generator.interfaces.AIsource.GetSource(data.config, {
		username,
		SaveConfig
	})
}

/**
 * 加载 AI 源。
 * @param {string} username - 用户的用户名。
 * @param {string} AIsourcename - AI 源的名称。
 * @returns {Promise<any>} 一个解析为已加载 AI 源的承诺。
 */
export async function loadAIsource(username, AIsourcename) {
	return loadPartBase(username, 'AIsources', AIsourcename, null, {
		/**
		 * 获取部件路径。
		 * @returns {string} 部件的路径。
		 */
		pathGetter: () => GetPath(username, AIsourcename),
		/**
		 * 异步加载器函数。
		 * @param {string} path - 部件的路径。
		 * @returns {Promise<any>} 解析为加载的部件的承诺。
		 */
		Loader: async path => {
			let data
			try { data = loadJsonFile(path + '.json') }
			catch (e) { throw skip_report(e) }
			const AIsource = await loadAIsourceFromConfigData(username, data, {
				/**
				 * 保存配置数据。
				 * @param {object} [newdata=data] - 要保存的新数据。
				 */
				SaveConfig: (newdata = data) => {
					saveJsonFile(path + '.json', newdata)
				}
			})
			AIsource.filename = AIsourcename
			return AIsource
		},
		/**
		 * 初始化器函数。
		 * @param {any} _ - 未使用的参数。
		 * @returns {number} 始终返回 0。
		 */
		Initer: _ => 0
	})
}

/**
 * 从名称或配置数据加载 AI 源。
 * @param {string} username - 用户的用户名。
 * @param {string|object} nameOrData - AI 源的名称或其配置数据。
 * @param {any[]} unnamedSources - 用于存储未命名 AI 源的数组。
 * @param {object} options - 加载 AI 源的选项。
 * @param {Function} options.SaveConfig - 保存配置数据的函数。
 * @returns {Promise<any>} 一个解析为已加载 AI 源的承诺。
 */
export async function loadAIsourceFromNameOrConfigData(username, nameOrData, unnamedSources, { SaveConfig }) {
	if (Object(nameOrData) instanceof String)
		return loadAIsource(username, nameOrData)
	else
		return unnamedSources[unnamedSources.push(loadAIsourceFromConfigData(username, nameOrData, { SaveConfig })) - 1]
}

/**
 * 卸载 AI 源。
 * @param {string} username - 用户的用户名。
 * @param {string} AIsourcename - AI 源的名称。
 * @returns {Promise<void>} 一个在 AI 源卸载后解析的承诺。
 */
export async function unloadAIsource(username, AIsourcename) {
	await unloadPartBase(username, 'AIsources', AIsourcename, {}, {
		/**
		 * 获取部件路径。
		 * @returns {string} 部件的路径。
		 */
		pathGetter: () => GetPath(username, AIsourcename),
		/**
		 * 卸载后调用的函数。
		 * @param {any} _ - 未使用的参数。
		 * @returns {number} 始终返回 0。
		 */
		afterUnload: _ => 0
	})
}

/**
 * 检查 AI 源是否已加载。
 * @param {string} username - 用户的用户名。
 * @param {string} AIsourcename - AI 源的名称。
 * @returns {boolean} 如果 AI 源已加载则为 true，否则为 false。
 */
export function isAIsourceLoaded(username, AIsourcename) {
	return isPartLoaded(username, 'AIsources', AIsourcename)
}

/**
 * 重新加载 AI 源。
 * @param {string} username - 用户的用户名。
 * @param {string} AIsourcename - AI 源的名称。
 * @returns {Promise<void>} 一个在 AI 源重新加载后解析的承诺。
 */
export async function reloadAIsource(username, AIsourcename) {
	await unloadAIsource(username, AIsourcename)
	await loadAIsource(username, AIsourcename)
}

/**
 * 加载用户的默认 AI 源。
 * @param {string} username - 用户的用户名。
 * @returns {Promise<any>} 一个解析为已加载 AI 源的承诺。
 */
export async function loadDefaultAIsource(username) {
	const defaultAIsourceName = getAnyDefaultPart(username, 'AIsources')
	if (!defaultAIsourceName) return
	return loadAIsource(username, defaultAIsourceName)
}
