import path from 'node:path'

import { readJsonFile, readJsonFileSync, writeJsonFile, writeJsonFileSync } from '../utils/json_io.mjs'

import { getNodeDir } from './instance.mjs'

/**
 * @param {string} name 不含扩展名的配置文件名
 * @returns {string} 绝对路径
 */
export function nodeJsonPath(name) {
	return path.join(getNodeDir(), `${name}.json`)
}

/**
 * @param {string} name 配置文件名
 * @returns {Promise<object | null>} 解析后的 JSON 或 null
 */
export async function readNodeJson(name) {
	return readJsonFile(nodeJsonPath(name))
}

/**
 * @param {string} name 配置文件名
 * @param {unknown} data 数据
 * @returns {Promise<void>}
 */
export async function writeNodeJson(name, data) {
	await writeNodeJsonFile(name, data)
}

/**
 * @param {string} name 配置文件名
 * @param {unknown} data 数据
 * @returns {Promise<void>}
 */
export async function writeNodeJsonFile(name, data) {
	await writeJsonFile(nodeJsonPath(name), data)
}

/**
 * @param {string} name 配置文件名
 * @returns {object | null} 解析后的 JSON 或 null
 */
export function readNodeJsonSync(name) {
	return readJsonFileSync(nodeJsonPath(name))
}

/**
 * @param {string} name 配置文件名
 * @param {unknown} data 数据
 * @returns {void}
 */
export function writeNodeJsonSync(name, data) {
	writeJsonFileSync(nodeJsonPath(name), data)
}
