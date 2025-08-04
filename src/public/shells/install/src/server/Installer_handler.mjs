import { LoadImportHandler } from '../../../../../server/managers/ImportHandlers_manager.mjs'
import { getPartListBase, GetPartPath } from '../../../../../server/parts_loader.mjs'
import { loadJsonFileIfExists } from '../../../../../scripts/json_loader.mjs'
import { skip_report } from '../../../../../server/server.mjs'

function getImportHandlerList(username) {
	return getPartListBase(username, 'ImportHandlers').map(
		name => ({
			name,
			order: loadJsonFileIfExists(GetPartPath(username, 'ImportHandlers', name) + '/order.txt', 0),
		})
	).sort((a, b) => b.order - a.order).map(a => a.name)
}
export async function importPart(username, data) {
	const ImportHandlers = getImportHandlerList(username)
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
		throw skip_report(Object.assign(new Error('All handlers failed'), { errors }))
}

export async function importPartByText(username, text) {
	const ImportHandlers = getImportHandlerList(username)
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
