import { getUserDictionary } from "./auth.mjs"
import fs from 'fs'

let userDataSet = {}
export function loadData(username, dataname) {
	userDataSet[username] ??= {}
	try {
		return userDataSet[username][dataname] ??= JSON.parse(fs.readFileSync(getUserDictionary(username) + '/settings/' + dataname + '.json', 'utf8'))
	}
	catch (error) {
		return userDataSet[username][dataname] = {}
	}
}
export function saveData(username, dataname) {
	fs.writeFileSync(getUserDictionary(username) + '/settings/' + dataname + '.json', JSON.stringify(userDataSet[username][dataname], null, '\t'))
}
