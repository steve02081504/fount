import fs from 'node:fs'

import { on_shutdown } from 'npm:on-shutdown'

import { saveJsonFile, loadJsonFileIfExists } from '../scripts/json_loader.mjs'

import { getUserDictionary } from './auth/index.mjs'
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
	const settingsDir = getUserDictionary(username) + '/settings'
	fs.mkdirSync(settingsDir, { recursive: true })
	saveJsonFile(settingsDir + '/' + dataname + '.json', userDataSet[username][dataname])
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

/**
 * 覆盖内存中的 shell 数据块并立即落盘（用于无法通过 `loadShellData` 返回引用安全改型的场景）。
 * @param {string} username 用户名
 * @param {string} shellname shell 名（如 `chat`）
 * @param {string} dataname 数据名（不含 `.json`）
 * @param {unknown} value 可 JSON 序列化的值
 * @returns {void}
 */
export function assignShellData(username, shellname, dataname, value) {
	userShellDataSet[username] ??= {}
	userShellDataSet[username][shellname] ??= {}
	userShellDataSet[username][shellname][dataname] = value
	saveShellData(username, shellname, dataname)
}
on_shutdown(() => {
	for (const username in userShellDataSet)
		for (const shellname in userShellDataSet[username])
			for (const dataname in userShellDataSet[username][shellname])
				saveShellData(username, shellname, dataname)
})

/**
 * 实体私有 shelldata：`shells/{shell}/entities/{entityHash}/{dataname}.json`
 * @type {object}
 */
const userEntityShellDataSet = {}

/**
 * @param {string} entityHash 实体 hash
 * @returns {string} 规范化小写 hash
 */
function normalizeEntityHashKey(entityHash) {
	return String(entityHash || '').trim().toLowerCase()
}

/**
 * 实体私有 shell 数据路径（不含文件名）。
 * @param {string} username 用户
 * @param {string} shellname shell 名
 * @param {string} entityHash 实体 hash
 * @returns {string} 目录路径
 */
function entityShellDir(username, shellname, entityHash) {
	return `${getUserDictionary(username)}/shells/${shellname}/entities/${normalizeEntityHashKey(entityHash)}`
}

/**
 * 从 JSON 加载实体私有 shell 数据。
 * @param {string} username 用户
 * @param {string} shellname shell 名
 * @param {string} entityHash 实体 hash
 * @param {string} dataname 数据名（不含 `.json`）
 * @returns {object} 加载的数据
 */
export function loadEntityShellData(username, shellname, entityHash, dataname) {
	const hash = normalizeEntityHashKey(entityHash)
	userEntityShellDataSet[username] ??= {}
	userEntityShellDataSet[username][shellname] ??= {}
	userEntityShellDataSet[username][shellname][hash] ??= {}
	try {
		return userEntityShellDataSet[username][shellname][hash][dataname]
			??= loadJsonFileIfExists(`${entityShellDir(username, shellname, hash)}/${dataname}.json`)
	}
	catch (error) {
		console.error(error)
		return userEntityShellDataSet[username][shellname][hash][dataname] = {}
	}
}

/**
 * 将实体私有 shell 数据落盘。
 * @param {string} username 用户
 * @param {string} shellname shell 名
 * @param {string} entityHash 实体 hash
 * @param {string} dataname 数据名（不含 `.json`）
 * @returns {void}
 */
export function saveEntityShellData(username, shellname, entityHash, dataname) {
	const hash = normalizeEntityHashKey(entityHash)
	const dir = entityShellDir(username, shellname, hash)
	fs.mkdirSync(dir, { recursive: true })
	saveJsonFile(`${dir}/${dataname}.json`, userEntityShellDataSet[username][shellname][hash][dataname])
}

/**
 * 覆盖内存中的实体私有 shell 数据块并立即落盘。
 * @param {string} username 用户
 * @param {string} shellname shell 名
 * @param {string} entityHash 实体 hash
 * @param {string} dataname 数据名（不含 `.json`）
 * @param {unknown} value 可 JSON 序列化的值
 * @returns {void}
 */
export function assignEntityShellData(username, shellname, entityHash, dataname, value) {
	const hash = normalizeEntityHashKey(entityHash)
	userEntityShellDataSet[username] ??= {}
	userEntityShellDataSet[username][shellname] ??= {}
	userEntityShellDataSet[username][shellname][hash] ??= {}
	userEntityShellDataSet[username][shellname][hash][dataname] = value
	saveEntityShellData(username, shellname, hash, dataname)
}
on_shutdown(() => {
	for (const username in userEntityShellDataSet)
		for (const shellname in userEntityShellDataSet[username])
			for (const entityHash in userEntityShellDataSet[username][shellname])
				for (const dataname in userEntityShellDataSet[username][shellname][entityHash])
					saveEntityShellData(username, shellname, entityHash, dataname)
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
	delete userEntityShellDataSet[username]
	delete userTempDataSet[username]
})

events.on('AfterUserRenamed', ({ oldUsername, newUsername }) => {
	userDataSet[newUsername] = userDataSet[oldUsername] ?? {}
	delete userDataSet[oldUsername]
	userShellDataSet[newUsername] = userShellDataSet[oldUsername] ?? {}
	delete userShellDataSet[oldUsername]
	userEntityShellDataSet[newUsername] = userEntityShellDataSet[oldUsername] ?? {}
	delete userEntityShellDataSet[oldUsername]
	userTempDataSet[newUsername] = userTempDataSet[oldUsername] ?? {}
	delete userTempDataSet[oldUsername]
})
