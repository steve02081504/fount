import { getUserDictionary } from './auth.mjs'
import { saveJsonFile, loadJsonFile } from '../scripts/json_loader.mjs'
import { on_shutdown } from './on_shutdown.mjs'

const userDataSet = {}
export function loadData(username, dataname) {
	userDataSet[username] ??= {}
	try {
		return userDataSet[username][dataname] ??= loadJsonFile(getUserDictionary(username) + '/settings/' + dataname + '.json')
	}
	catch (error) {
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

// tempdata 用于临时存储数据
const userTempDataSet = {}
export function loadTempData(username, dataname) {
	userTempDataSet[username] ??= {}
	return userTempDataSet[username][dataname] ??= {}
}
// 无需保存 :)
