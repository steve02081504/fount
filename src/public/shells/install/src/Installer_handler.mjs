import { loadJsonFileIfExists } from '../../../../scripts/json_loader.mjs'
import { LoadImportHandler } from '../../../../server/managers/ImportHandlers_manager.mjs'
import { getPartListBase, GetPartPath, notifyPartInstall } from '../../../../server/parts_loader.mjs'
import { skip_report } from '../../../../server/server.mjs'

/**
 * @description 获取导入处理器列表。
 * @param {string} username - 用户名。
 * @returns {Array<string>} - 导入处理器列表。
 */
function getImportHandlerList(username) {
	return getPartListBase(username, 'ImportHandlers').map(
		name => ({
			name,
			order: loadJsonFileIfExists(GetPartPath(username, 'ImportHandlers', name) + '/order.txt', 0),
		})
	).sort((a, b) => b.order - a.order).map(a => a.name)
}
/**
 * @description 导入部件。
 * @param {string} username - 用户名。
 * @param {any} data - 数据。
 * @returns {Promise<void>}
 */
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

/**
 * @description 通过文本导入部件。
 * @param {string} username - 用户名。
 * @param {string} text - 文本。
 * @returns {Promise<void>}
 */
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
