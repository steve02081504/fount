import { getServiceSourceFile, saveServiceSourceFile } from '../../serviceSourceManage/src/manager.mjs'

/**
 * GetData 返回的是部件缓存中的对象；保存时不能把新 config 写回原对象，
 * 否则 SetData 清空旧 config 时也会清空待写入的 config。
 * @param {object} data - 服务源当前数据。
 * @param {object} oauth - 新凭证。
 * @returns {object} 独立的待保存数据。
 */
export function withOAuthCredentials(data, oauth) {
	return { ...data, config: { ...data.config, oauth } }
}

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
	await saveServiceSourceFile(username, sourceName, withOAuthCredentials(data, oauth), path)
}
