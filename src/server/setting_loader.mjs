import { getUserDictionary } from './auth.mjs'
import { saveJsonFile, loadJsonFileIfExists } from '../scripts/json_loader.mjs'
import { on_shutdown } from './on_shutdown.mjs'
import fs from 'node:fs'

const userDataSet = {}
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
export function saveData(username, dataname) {
	saveJsonFile(getUserDictionary(username) + '/settings/' + dataname + '.json', userDataSet[username][dataname])
}
on_shutdown(() => {
	for (const username in userDataSet)
		for (const dataname in userDataSet[username])
			saveData(username, dataname)
})

// shelldata 用于存储 特定 shell 的特定数据
const userShellDataSet = {}
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

// tempdata 用于临时存储数据
const userTempDataSet = {}
export function loadTempData(username, dataname) {
	userTempDataSet[username] ??= {}
	return userTempDataSet[username][dataname] ??= {}
}
// 无需保存 :)
