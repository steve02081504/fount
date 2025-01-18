import { LoadImportHanlder } from './importHanlder_manager.mjs'
import { getPartListBase } from '../../../../../server/parts_loader.mjs'

export async function importPart(username, data) {
	let ImportHanlders = getPartListBase(username, 'ImportHanlders')
	const errors = []

	for (let importHanlder of ImportHanlders)
		try {
			let hanlder = await LoadImportHanlder(username, importHanlder)
			await hanlder.ImportAsData(username, data)
			return
		} catch (err) {
			errors.push({ hanlder: importHanlder, error: err.message || String(err) })
			console.log(`hanlder ${importHanlder} failed:`, err)
		}

	// 如果所有模板都失败，抛出包含所有错误的异常
	if (errors.length > 0)
		throw Object.assign(new Error('All hanlders failed'), { errors })
}

export async function importPartByText(username, text) {
	let ImportHanlders = getPartListBase(username, 'ImportHanlders')
	const errors = []

	for (let importHanlder of ImportHanlders)
		try {
			let hanlder = await LoadImportHanlder(username, importHanlder)
			await hanlder.ImportByText(username, text)
			return
		} catch (err) {
			errors.push({ hanlder: importHanlder, error: err.message || String(err) })
			console.log(`hanlder ${importHanlder} failed:`, err)
		}


	if (errors.length > 0)
		throw Object.assign(new Error('All hanlders failed'), { errors })
}
