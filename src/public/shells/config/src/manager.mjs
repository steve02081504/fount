import { loadPart } from '../../../../server/managers/index.mjs'
import { loadData, saveData } from '../../../../server/setting_loader.mjs'

/**
 * 获取部件数据。
 * @param {string} username - 用户名。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 部件名称。
 * @returns {Promise<any>} - 部件数据。
 */
export async function getPartData(username, parttype, partname) {
	try {
		const part = await loadPart(username, parttype, partname)
		return await part.interfaces.config.GetData()
	}
	catch (error) {
		throw new Error(`Failed to get data for part ${partname}: ${error.message}\n${error.stack}`)
	}
}

/**
 * 设置部件数据。
 * @param {string} username - 用户名。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 部件名称。
 * @param {any} data - 数据。
 * @returns {Promise<void>}
 */
export async function setPartData(username, parttype, partname, data) {
	const parts_config = loadData(username, 'parts_config')
	try {
		const part = await loadPart(username, parttype, partname)
		await part.interfaces.config.SetData(data)
		parts_config[parttype] ??= {}
		parts_config[parttype][partname] = data
		saveData(username, 'parts_config')
	}
	catch (error) {
		throw new Error(`Failed to set data for part ${partname}: ${error.message}\n${error.stack}`)
	}
}

/**
 * 获取部件显示内容。
 * @param {string} username - 用户名。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 部件名称。
 * @returns {Promise<object>} - 显示内容。
 */
export async function getPartDisplayContent(username, parttype, partname) {
	const part = await loadPart(username, parttype, partname)
	return await part.interfaces.config?.GetConfigDisplayContent?.() || { html: '', js: '' }
}
