import { LoadImportHandler } from './importHandler_manager.mjs'
import { getPartListBase } from '../../../../../server/parts_loader.mjs'

export async function importPart(username, data) {
	const ImportHandlers = getPartListBase(username, 'ImportHandlers')
	const errors = []

	for (const importHandler of ImportHandlers)
		try {
			const handler = await LoadImportHandler(username, importHandler)
			await handler.interfaces.import.ImportAsData(username, data)
			return
		} catch (err) {
			errors.push({ handler: importHandler, error: err.message || String(err) })
			console.log(`handler ${importHandler} failed:`, err)
		}

	// 如果所有模板都失败，抛出包含所有错误的异常
	if (errors.length > 0)
		throw Object.assign(new Error('All handlers failed'), { errors })
}

export async function importPartByText(username, text) {
	const ImportHandlers = getPartListBase(username, 'ImportHandlers')
	const errors = []

	for (const importHandler of ImportHandlers)
		try {
			const handler = await LoadImportHandler(username, importHandler)
			await handler.interfaces.import.ImportByText(username, text)
			return
		} catch (err) {
			errors.push({ handler: importHandler, error: err.message || String(err) })
			console.log(`handler ${importHandler} failed:`, err)
		}


	if (errors.length > 0)
		throw Object.assign(new Error('All handlers failed'), { errors })
}
