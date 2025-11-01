import fs from 'node:fs'

import sanitize from 'npm:sanitize-filename'

import { loadJsonFile, saveJsonFile } from '../../../../scripts/json_loader.mjs'
import { getUserDictionary } from '../../../../server/auth.mjs'
import { isAIsourceLoaded, loadAIsourceGenerator, reloadAIsource } from '../../../../server/managers/AIsource_manager.mjs'

/**
 * 获取AI源文件
 * @param {string} username - 用户名
 * @param {string} fileName - 文件名
 * @returns {Promise<object>} - AI源文件内容
 */
export function getAISourceFile(username, fileName) {
	const fname = getUserDictionary(username) + '/AIsources/' + sanitize(fileName) + '.json'
	return loadJsonFile(fname)
}

/**
 * 保存AI源文件
 * @param {string} username - 用户名
 * @param {string} fileName - 文件名
 * @param {object} data - 数据
 * @returns {Promise<void>}
 */
export async function saveAISourceFile(username, fileName, data) {
	const fname = getUserDictionary(username) + '/AIsources/' + sanitize(fileName) + '.json'
	saveJsonFile(fname, data)
	if (isAIsourceLoaded(username, sanitize(fileName)))
		await reloadAIsource(username, sanitize(fileName))
}

/**
 * 添加AI源文件
 * @param {string} username - 用户名
 * @param {string} fileName - 文件名
 * @returns {void}
 */
export function addAISourceFile(username, fileName) {
	const fname = getUserDictionary(username) + '/AIsources/' + sanitize(fileName) + '.json'
	saveJsonFile(fname, {
		generator: '',
		config: {}
	})
}

/**
 * 删除AI源文件
 * @param {string} username - 用户名
 * @param {string} fileName - 文件名
 * @returns {Promise<void>}
 */
export function deleteAISourceFile(username, fileName) {
	const fname = getUserDictionary(username) + '/AIsources/' + sanitize(fileName) + '.json'
	return fs.promises.unlink(fname)
}

/**
 * 获取配置模板
 * @param {string} username - 用户名
 * @param {string} generatorname - 生成器名称
 * @returns {Promise<object>} - 配置模板
 */
export async function getConfigTemplate(username, generatorname) {
	const generator = await loadAIsourceGenerator(username, generatorname)
	return await generator.interfaces.AIsource.GetConfigTemplate()
}

/**
 * 获取配置显示
 * @param {string} username - 用户名
 * @param {string} generatorname - 生成器名称
 * @returns {Promise<object>} - 配置显示
 */
export async function getConfigDisplay(username, generatorname) {
	const generator = await loadAIsourceGenerator(username, generatorname)
	return await generator.interfaces.AIsource?.GetConfigDisplayContent?.() || { html: '', js: '' }
}
