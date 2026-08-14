import { getServiceSourceFile, saveServiceSourceFile } from '../../serviceSourceManage/src/manager.mjs'

/**
 * 把 OAuth 凭证写入服务源 config.oauth。
 * @param {string} username - 用户名。
 * @param {string} sourceName - 服务源名。
 * @param {string} [serviceSourcePath='serviceSources/AI'] - 服务源路径。
 * @param {object} oauth - 凭证。
 * @returns {Promise<void>}
 */
export async function persistOAuthToSource(username, sourceName, serviceSourcePath, oauth) {
	if (!sourceName) return
	const path = serviceSourcePath || 'serviceSources/AI'
	const data = await getServiceSourceFile(username, sourceName, path)
	data.config = { ...data.config, oauth }
	await saveServiceSourceFile(username, sourceName, data, path)
}
