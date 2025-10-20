import { loadJsonFileIfExists } from '../../../../scripts/json_loader.mjs'
import { LoadImportHandler } from '../../../../server/managers/ImportHandlers_manager.mjs'
import { getPartListBase, GetPartPath, notifyPartInstall } from '../../../../server/parts_loader.mjs'
import { skip_report } from '../../../../server/server.mjs'

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

	for (const importHandler of ImportHandlers) try {
		const handler = await LoadImportHandler(username, importHandler)
		const installedParts = await handler.interfaces.import.ImportAsData(username, data)
		for (const part of installedParts)
			notifyPartInstall(username, part.parttype, part.partname)

		return
	} catch (err) {
		errors.push({ handler: importHandler, error: err.message || String(err) })
		console.log(`handler ${importHandler} failed:`, err)
	}

	// 如果所有模板都失败，抛出包含所有错误的异常
	if (errors.length)
		throw skip_report(Object.assign(new Error('All handlers failed'), { errors }))
}

export async function importPartByText(username, text) {
	const ImportHandlers = getImportHandlerList(username)
	const errors = []

	for (const importHandler of ImportHandlers) try {
		const handler = await LoadImportHandler(username, importHandler)
		const installedParts = await handler.interfaces.import.ImportByText(username, text)
		if (installedParts && installedParts.length)
			for (const part of installedParts)
				notifyPartInstall(username, part.parttype, part.partname)

		return
	} catch (err) {
		errors.push({ handler: importHandler, error: err.message || String(err) })
		console.log(`handler ${importHandler} failed:`, err)
	}


	if (errors.length) throw Object.assign(new Error('All handlers failed'), { errors })
}
