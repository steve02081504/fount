import { loadPart } from '../../../../../server/parts_loader.mjs'
import { skip_report } from '../../../../../server/server.mjs'
import { loadData, saveData } from '../../../../../server/setting_loader.mjs'

/**
 * 获取部件数据。
 * @param {string} username - 用户名。
 * @param {string} partpath - 部件路径。
 * @returns {Promise<any>} - 部件数据。
 */
export async function getPartData(username, partpath) {
	try {
		const normalized = partpath?.replace(/^\/+|\/+$/g, '')
		if (!normalized) throw new Error('partpath is required')
		const part = await loadPart(username, normalized)
		return await part.interfaces.config.GetData()
	}
	catch (error) {
		throw new Error(`Failed to get data for part ${partpath}: ${error.message}\n${error.stack}`)
	}
}

/**
 * 设置部件数据。
 * @param {string} username - 用户名。
 * @param {string} partpath - 部件路径。
 * @param {any} data - 数据。
 * @returns {Promise<void>}
 */
export async function setPartData(username, partpath, data) {
	const normalized = partpath?.replace(/^\/+|\/+$/g, '')
	if (!normalized) throw new Error('partpath is required')
	const parts_config = loadData(username, 'parts_config')
	try {
		const part = await loadPart(username, normalized)
		await part.interfaces.config.SetData(data)
		parts_config[normalized] = data
		saveData(username, 'parts_config')
	}
	catch (error) {
		throw skip_report(new Error(`Failed to set data for part ${partpath}: ${error.message}\n${error.stack}`))
	}
}

/**
 * 获取部件显示内容。
 * @param {string} username - 用户名。
 * @param {string} partpath - 部件路径。
 * @returns {Promise<object>} - 显示内容。
 */
export async function getPartDisplayContent(username, partpath) {
	const normalized = partpath?.replace(/^\/+|\/+$/g, '')
	if (!normalized) throw new Error('partpath is required')
	const part = await loadPart(username, normalized)
	return await part.interfaces?.config?.GetConfigDisplayContent?.() || { html: '', js: '' }
}
