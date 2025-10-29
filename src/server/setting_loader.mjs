import fs from 'node:fs'

import { on_shutdown } from 'npm:on-shutdown'

import { saveJsonFile, loadJsonFileIfExists } from '../scripts/json_loader.mjs'

import { getUserDictionary } from './auth.mjs'
import { events } from './events.mjs'


const userDataSet = {}
/**
 * 从 JSON 文件加载用户数据。
 * @param {string} username - 用户的用户名。
 * @param {string} dataname - 要加载的数据的名称。
 * @returns {object} 加载的数据。
 */
export function loadData(username, dataname) {
	userDataSet[username] ??= {}
	try {
		return userDataSet[username][dataname] ??= loadJsonFileIfExists(getUserDictionary(username) + '/settings/' + dataname + '.json')
	}
	catch (error) {
		console.error(error)
		return userDataSet[username][dataname] = {}
	}
}
/**
 * 将用户数据保存到 JSON 文件。
 * @param {string} username - 用户的用户名。
 * @param {string} dataname - 要保存的数据的名称。
 * @returns {void}
 */
export function saveData(username, dataname) {
	saveJsonFile(getUserDictionary(username) + '/settings/' + dataname + '.json', userDataSet[username][dataname])
}
on_shutdown(() => {
	for (const username in userDataSet)
		for (const dataname in userDataSet[username])
			saveData(username, dataname)
})

/**
 * shelldata 用于存储特定于 shell 的数据。
 * @type {object}
 */
const userShellDataSet = {}
/**
 * 从 JSON 文件加载特定于 shell 的用户数据。
 * @param {string} username - 用户的用户名。
 * @param {string} shellname - shell 的名称。
 * @param {string} dataname - 要加载的数据的名称。
 * @returns {object} 加载的数据。
 */
export function loadShellData(username, shellname, dataname) {
	userShellDataSet[username] ??= {}
	userShellDataSet[username][shellname] ??= {}
	try {
		return userShellDataSet[username][shellname][dataname] ??= loadJsonFileIfExists(getUserDictionary(username) + '/shells/' + shellname + '/' + dataname + '.json')
	}
	catch (error) {
		console.error(error)
		return userShellDataSet[username][shellname][dataname] = {}
	}
}
/**
 * 将特定于 shell 的用户数据保存到 JSON 文件。
 * @param {string} username - 用户的用户名。
 * @param {string} shellname - shell 的名称。
 * @param {string} dataname - 要保存的数据的名称。
 * @returns {void}
 */
export function saveShellData(username, shellname, dataname) {
	fs.mkdirSync(getUserDictionary(username) + '/shells/' + shellname, { recursive: true })
	saveJsonFile(getUserDictionary(username) + '/shells/' + shellname + '/' + dataname + '.json', userShellDataSet[username][shellname][dataname])
}
on_shutdown(() => {
	for (const username in userShellDataSet)
		for (const shellname in userShellDataSet[username])
			for (const dataname in userShellDataSet[username][shellname])
				saveShellData(username, shellname, dataname)
})

/**
 * tempdata 用于临时数据存储。
 * @type {object}
 */
const userTempDataSet = {}
/**
 * 加载用户的临时数据。
 * @param {string} username - 用户的用户名。
 * @param {string} dataname - 要加载的数据的名称。
 * @returns {object} 加载的数据。
 */
export function loadTempData(username, dataname) {
	userTempDataSet[username] ??= {}
	return userTempDataSet[username][dataname] ??= {}
}
// 无需保存 :)

// 事件处理程序
events.on('AfterUserDeleted', ({ username }) => {
	delete userDataSet[username]
	delete userShellDataSet[username]
	delete userTempDataSet[username]
})

events.on('AfterUserRenamed', ({ oldUsername, newUsername }) => {
	userDataSet[newUsername] = userDataSet[oldUsername] ?? {}
	delete userDataSet[oldUsername]
	userShellDataSet[newUsername] = userShellDataSet[oldUsername] ?? {}
	delete userShellDataSet[oldUsername]
	userTempDataSet[newUsername] = userTempDataSet[oldUsername] ?? {}
	delete userTempDataSet[oldUsername]
})
