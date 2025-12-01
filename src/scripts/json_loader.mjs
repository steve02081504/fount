import fs from 'node:fs'

import { nicerWriteFileSync } from './nicerWriteFile.mjs'

/**
 * 加载一个 JSON 文件。
 * @param {string} filename - 要加载的文件的名称。
 * @returns {any} 解析后的 JSON 数据。
 */
export function loadJsonFile(filename) {
	return JSON.parse(fs.readFileSync(filename, 'utf8'))
}

/**
 * 如果 JSON 文件存在，则加载它，否则返回默认值。
 * @param {string} filename - 要加载的文件的名称。
 * @param {any} [defaultvalue={}] - 如果文件不存在，要返回的默认值。
 * @returns {any} 解析后的 JSON 数据或默认值。
 */
export function loadJsonFileIfExists(filename, defaultvalue = {}) {
	if (fs.existsSync(filename)) try {
		return loadJsonFile(filename)
	}
	catch (error) {
		console.error('Error loading JSON file:', filename, error)
		console.error('Moving file to .error.bak and using default value.')
		try { fs.renameSync(filename, filename + '.' + Date.now() + '.error.bak') } catch { /* fuck you >:( */ }
	}
	return defaultvalue
}

/**
 * 将 JSON 数据保存到文件。
 * @param {string} filename - 要保存的文件的名称。
 * @param {any} json - 要保存的 JSON 数据。
 * @returns {void}
 */
export function saveJsonFile(filename, json) {
	try {
		nicerWriteFileSync(filename, JSON.stringify(json, null, '\t') + '\n', { encoding: 'utf8' })
	}
	catch (error) {
		console.error('Error saving JSON file:', filename, error)
		throw error
	}
}
