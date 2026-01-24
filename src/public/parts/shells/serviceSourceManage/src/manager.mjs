import fs from 'node:fs'
import path from 'node:path'

import sanitize from 'npm:sanitize-filename'

import { saveJsonFile } from '../../../../../scripts/json_loader.mjs'
import { getUserDictionary } from '../../../../../server/auth.mjs'
import { initPart, isPartLoaded, loadPart } from '../../../../../server/parts_loader.mjs'
import { loadData, saveData } from '../../../../../server/setting_loader.mjs'

/**
 * 确保服务源路径合法。
 * @param {string} serviceSourcePath - 服务源路径
 * @returns {string} - 规范化后的服务源路径
 */
function normalizeServiceSourcePath(serviceSourcePath) {
	if (!serviceSourcePath?.startsWith('serviceSources/'))
		throw new Error('serviceSourcePath must start with "serviceSources/".')
	return serviceSourcePath
}

/**
 * 构造部件根目录。
 * @param {string} username - 用户名
 * @param {string} serviceSourcePath - 服务源路径
 * @param {string} fileName - 部件名
 * @returns {string} - 拼接后的目录
 */
function getServiceSourceDir(username, serviceSourcePath, fileName) {
	const safePath = normalizeServiceSourcePath(serviceSourcePath)
	return path.join(getUserDictionary(username), safePath, sanitize(fileName))
}

/**
 * 获取配置文件路径。
 * @param {string} baseDir - 部件根目录
 * @returns {string} - 配置文件路径
 */
function getConfigPath(baseDir) {
	return path.join(baseDir, 'config.json')
}

/**
 * 生成默认配置结构。
 * @returns {{generator: string, config: object}} - 默认配置
 */
function buildDefaultConfig() {
	return {
		generator: '',
		config: {}
	}
}

/**
 * 为新部件创建必需的文件结构（fount.json 与 main.mjs）。
 * @param {string} baseDir - 目标根目录
 * @param {string} serviceSourcePath - 服务源路径
 * @param {string} fileName - 部件名称
 * @returns {Promise<void>} - 写入完成
 */
async function createScaffold(baseDir, serviceSourcePath, fileName) {
	const normalizedServiceSourcePath = normalizeServiceSourcePath(serviceSourcePath)
	await fs.promises.mkdir(baseDir, { recursive: true })

	const fountPath = path.join(baseDir, 'fount.json')
	if (!fs.existsSync(fountPath))
		saveJsonFile(fountPath, {
			type: normalizedServiceSourcePath,
			dirname: fileName
		})

	const mainPath = path.join(baseDir, 'main.mjs')
	if (!fs.existsSync(mainPath)) {
		const mainContent = `\
import path from 'node:path'

import { loadJsonFileIfExists, saveJsonFile } from '../../../../../../src/scripts/json_loader.mjs'
import { loadPart } from '../../../../../../src/server/parts_loader.mjs'

const configPath = import.meta.dirname + '/config.json'
const data = loadJsonFileIfExists(configPath, { generator: '', config: {} })
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
		 * @param {any} data - 要设置的配置数据。
		 * @returns {Promise<void>}
		 */
		async SetData(new_data) {
			if (new_data.generator) data.generator = new_data.generator
			if (new_data.config) data.config = new_data.config
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

export default {
	filename: path.basename(import.meta.dirname),
	async Load({ username }) {
		const manager = await loadPart(username, '${normalizedServiceSourcePath}')
		Object.assign(this, await manager.interfaces.serviceSourceType.loadFromConfigData(username, data, {
			SaveConfig: defaultInterfaces.config.SetData
		}))
		Object.assign(this.interfaces, defaultInterfaces)
	},
	interfaces: defaultInterfaces
}
`
		await fs.promises.writeFile(mainPath, mainContent)
	}
}

/**
 * 读取服务源配置。
 * @param {string} username - 用户名
 * @param {string} fileName - 文件名
 * @param {string} serviceSourcePath - 服务源路径
 * @returns {Promise<object>} - 服务源文件内容
 */
export async function getServiceSourceFile(username, fileName, serviceSourcePath) {
	const normalizedServicePath = normalizeServiceSourcePath(serviceSourcePath)
	const partpath = `${normalizedServicePath}/${sanitize(fileName)}`
	const baseDir = getServiceSourceDir(username, normalizedServicePath, fileName)
	const configPath = getConfigPath(baseDir)

	// 如果文件不存在，返回默认配置
	if (!fs.existsSync(configPath))
		return buildDefaultConfig()


	// 加载part并通过GetData获取数据
	const part = await loadPart(username, partpath)
	const data = await part.interfaces.config.GetData()
	return data
}

/**
 * 从服务源路径推断生成器路径。
 * @param {string} serviceSourcePath - 服务源路径（如 'serviceSources/AI'）。
 * @returns {string} - 推断的生成器路径。
 */
function inferGeneratorPath(serviceSourcePath) {
	const segments = serviceSourcePath.split('/').filter(Boolean)
	const type = segments[segments.length - 1] || 'AI'
	return `serviceGenerators/${type}`
}

/**
 * 保存服务源配置。
 * @param {string} username - 用户名
 * @param {string} fileName - 文件名
 * @param {object} data - 数据
 * @param {string} serviceSourcePath - 服务源路径
 * @returns {Promise<void>}
 */
export async function saveServiceSourceFile(username, fileName, data, serviceSourcePath) {
	const normalizedServicePath = normalizeServiceSourcePath(serviceSourcePath)
	const baseDir = getServiceSourceDir(username, normalizedServicePath, fileName)
	const partpath = `${normalizedServicePath}/${sanitize(fileName)}`

	// 确保文件结构存在（如果不存在则创建）
	await createScaffold(baseDir, normalizedServicePath, fileName)

	// 准备要保存的数据
	const dataToSave = { ...buildDefaultConfig(), ...data }

	// 通过part的SetData接口保存数据
	const part = await loadPart(username, partpath)
	await part.interfaces.config.SetData(dataToSave)

	// 更新parts_config
	const parts_config = loadData(username, 'parts_config')
	parts_config[partpath] = { ...dataToSave }
	saveData(username, 'parts_config')

	if (isPartLoaded(username, partpath)) await initPart(username, partpath)
}

/**
 * 添加服务源部件。
 * @param {string} username - 用户名
 * @param {string} fileName - 文件名
 * @param {string} serviceSourcePath - 服务源路径
 * @returns {Promise<void>}
 */
export async function addServiceSourceFile(username, fileName, serviceSourcePath) {
	const normalizedServicePath = normalizeServiceSourcePath(serviceSourcePath)
	const baseDir = getServiceSourceDir(username, normalizedServicePath, fileName)
	const partpath = `${normalizedServicePath}/${sanitize(fileName)}`

	// 创建文件结构
	await createScaffold(baseDir, normalizedServicePath, fileName)

	// 准备初始数据
	const initialData = buildDefaultConfig()

	// 通过part的SetData接口设置初始数据
	const part = await loadPart(username, partpath)
	await part.interfaces.config.SetData(initialData)

	// 更新parts_config
	const parts_config = loadData(username, 'parts_config')
	parts_config[partpath] = { ...initialData }
	saveData(username, 'parts_config')
}

/**
 * 删除服务源部件。
 * @param {string} username - 用户名
 * @param {string} fileName - 文件名
 * @param {string} serviceSourcePath - 服务源路径
 * @returns {Promise<void>}
 */
export async function deleteServiceSourceFile(username, fileName, serviceSourcePath) {
	const baseDir = getServiceSourceDir(username, serviceSourcePath, fileName)
	if (fs.existsSync(baseDir))
		await fs.promises.rm(baseDir, { recursive: true, force: true })
}

/**
 * 获取配置模板。
 * @param {string} username - 用户名
 * @param {string} generatorname - 生成器名称
 * @param {string} serviceSourcePath - 服务源路径
 * @returns {Promise<object>} - 配置模板
 */
export async function getConfigTemplate(username, generatorname, serviceSourcePath) {
	if (!generatorname) return {}
	const generatorPath = inferGeneratorPath(serviceSourcePath)
	const generator = await loadPart(username, `${generatorPath}/${generatorname}`)
	return await generator.interfaces.serviceGenerator.GetConfigTemplate()
}

/**
 * 获取配置显示。
 * @param {string} username - 用户名
 * @param {string} generatorname - 生成器名称
 * @param {string} serviceSourcePath - 服务源路径
 * @returns {Promise<object>} - 配置显示
 */
export async function getConfigDisplay(username, generatorname, serviceSourcePath) {
	if (!generatorname) return { html: '', js: '' }
	const generatorPath = inferGeneratorPath(serviceSourcePath)
	const generator = await loadPart(username, `${generatorPath}/${generatorname}`)
	return await generator.interfaces.serviceGenerator?.GetConfigDisplayContent?.() || { html: '', js: '' }
}
