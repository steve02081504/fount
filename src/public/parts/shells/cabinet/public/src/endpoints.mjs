/**
 * Cabinet shell 前端 named HTTP 端点。
 */
import { cabinetStore, currentUnlockToken } from './state.mjs'

const API = '/api/parts/shells:cabinet'

/**
 * @param {string} method HTTP 方法
 * @param {string} path 路径
 * @param {object} [body] body
 * @param {Record<string, string>} [headers] 额外头
 * @returns {Promise<any>} JSON / blob
 */
async function request(method, path, body, headers = {}) {
	const res = await fetch(`${API}${path}`, {
		method,
		credentials: 'include',
		headers: {
			...body ? { 'Content-Type': 'application/json' } : {},
			...headers,
		},
		body: body ? JSON.stringify(body) : undefined,
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || err.message || `${method} ${path} ${res.status}`)
	}
	if (res.headers.get('Content-Type')?.includes('application/zip'))
		return res.blob()
	return res.json()
}

/**
 * @param {string} [unlockToken] token
 * @returns {Record<string, string>} headers
 */
export function unlockHeaders(unlockToken) {
	return unlockToken ? { 'X-Cabinet-Unlock': unlockToken } : {}
}

/**
 * @param {string} href 链接
 * @param {string} [filename] 下载名
 * @returns {void}
 */
export function triggerDownload(href, filename) {
	const a = document.createElement('a')
	a.href = href
	if (filename) a.download = filename
	a.click()
}

/**
 * 当前柜路径请求（自动带 unlock）。
 * @param {string} method HTTP
 * @param {string} subpath 相对 `/cabinets/:id` 的路径
 * @param {object} [body] body
 * @param {{ cabinetId?: string, unlock?: string }} [opts] 覆盖
 * @returns {Promise<any>} JSON / blob
 */
function cabinetRequest(method, subpath, body, opts = {}) {
	const id = opts.cabinetId ?? cabinetStore.currentCabinetId
	return request(
		method,
		`/cabinets/${encodeURIComponent(id)}${subpath}`,
		body,
		unlockHeaders(Object.hasOwn(opts, 'unlock') ? opts.unlock : currentUnlockToken()),
	)
}

/**
 * 列出本地柜。
 * @returns {Promise<{ cabinets: object[] }>} 柜列表
 */
export function listCabinets() {
	return request('GET', '/cabinets')
}

/**
 * 创建个人柜。
 * @param {object} body 创建参数
 * @returns {Promise<{ cabinet: object }>} 新建柜
 */
export function createCabinet(body) {
	return request('POST', '/cabinets', body)
}

/**
 * 更新柜元数据。
 * @param {string} cabinetId 柜
 * @param {object} patch 补丁
 * @returns {Promise<any>} 更新结果
 */
export function patchCabinet(cabinetId, patch) {
	return request('PATCH', `/cabinets/${encodeURIComponent(cabinetId)}`, patch)
}

/**
 * 删除柜。
 * @param {string} cabinetId 柜
 * @returns {Promise<any>} 删除结果
 */
export function deleteCabinet(cabinetId) {
	return request('DELETE', `/cabinets/${encodeURIComponent(cabinetId)}`)
}

/**
 * 列出柜内条目（index）。
 * @param {string} cabinetId 柜
 * @param {URLSearchParams | string} query index 查询
 * @param {Record<string, string>} [headers] 额外头（如 unlock）
 * @returns {Promise<any>} index 响应
 */
export function listEntries(cabinetId, query, headers) {
	const q = String(query)
	return request('GET', `/cabinets/${encodeURIComponent(cabinetId)}/index${q ? `?${q}` : ''}`, null, headers)
}

/**
 * 列出远端实体可见柜。
 * @param {string} entityHash 远端实体
 * @returns {Promise<{ cabinets: object[] }>} 柜列表
 */
export function listRemoteCabinets(entityHash) {
	return request('GET', `/remote/${encodeURIComponent(entityHash)}/cabinets`)
}

/**
 * 列出远端柜内条目。
 * @param {string} entityHash 远端实体
 * @param {string} cabinetId 柜
 * @param {URLSearchParams | string} query index 查询
 * @returns {Promise<any>} index 响应
 */
export function listRemoteEntries(entityHash, cabinetId, query) {
	const q = String(query)
	return request(
		'GET',
		`/remote/${encodeURIComponent(entityHash)}/cabinets/${encodeURIComponent(cabinetId)}/index${q ? `?${q}` : ''}`,
	)
}

/**
 * 当前 viewer 实体信息。
 * @returns {Promise<{ viewer_entity_hash: string }>} viewer
 */
export function getViewer() {
	return request('GET', '/viewer')
}

/**
 * 解锁密码文件夹。
 * @param {{ folder_id: string, password: string }} body 解锁参数
 * @returns {Promise<{ unlock_token: string }>} unlock token
 */
export function unlockCabinet(body) {
	return cabinetRequest('POST', '/unlock', body, { unlock: undefined })
}

/**
 * 解析链接条目目标。
 * @param {string} entryId 条目
 * @param {{ cabinetId?: string, unlock?: string }} [opts] 覆盖
 * @returns {Promise<any>} resolve 结果
 */
export function resolveEntry(entryId, opts) {
	return cabinetRequest('GET', `/entries/${encodeURIComponent(entryId)}/resolve`, null, opts)
}

/**
 * 上传条目预览图。
 * @param {object} body 预览上传
 * @param {{ cabinetId?: string, unlock?: string }} [opts] 覆盖
 * @returns {Promise<{ url: string }>} 预览 URL
 */
export function uploadPreview(body, opts) {
	return cabinetRequest('POST', '/preview', body, opts)
}

/**
 * 创建条目（文件 / 文件夹 / 链接等）。
 * @param {object} body 创建参数
 * @param {{ cabinetId?: string, unlock?: string }} [opts] 覆盖
 * @returns {Promise<{ entry: object }>} 新建条目
 */
export function createEntry(body, opts) {
	return cabinetRequest('POST', '/entries', body, opts)
}

/**
 * 更新条目。
 * @param {string} entryId 条目
 * @param {object} patch 补丁
 * @param {{ cabinetId?: string, unlock?: string }} [opts] 覆盖
 * @returns {Promise<any>} 更新结果
 */
export function patchEntry(entryId, patch, opts) {
	return cabinetRequest('PATCH', `/entries/${encodeURIComponent(entryId)}`, patch, opts)
}

/**
 * 复制条目到目标柜/目录。
 * @param {string} sourceCabinetId 源柜
 * @param {object} body 复制参数
 * @param {Record<string, string>} [headers] 额外头（目标 unlock）
 * @returns {Promise<{ entries: object[] }>} 新建条目
 */
export function copyEntries(sourceCabinetId, body, headers) {
	return request('POST', `/cabinets/${encodeURIComponent(sourceCabinetId)}/entries/copy`, body, headers)
}

/**
 * 下载柜/文件夹 zip。
 * @param {string} [query] zip 查询串（可含 folder_id=…）
 * @param {{ cabinetId?: string, unlock?: string }} [opts] 覆盖
 * @returns {Promise<Blob>} zip blob
 */
export function downloadZip(query = '', opts) {
	return cabinetRequest('GET', `/zip${query ? `?${query}` : ''}`, null, opts)
}

/**
 * 可恢复删除条目。
 * @param {string[]} entryIds 条目
 * @param {{ cabinetId?: string, unlock?: string }} [opts] 覆盖
 * @returns {Promise<{ deleted: string[], recovery_token?: string }>} 删除结果
 */
export function deleteEntries(entryIds, opts) {
	return cabinetRequest('DELETE', '/entries', { entry_ids: entryIds, recoverable: true }, opts)
}

/**
 * 按 recovery token 恢复条目。
 * @param {string} recoveryToken token
 * @param {{ cabinetId?: string, unlock?: string }} [opts] 覆盖
 * @returns {Promise<any>} 恢复结果
 */
export function restoreEntries(recoveryToken, opts) {
	return cabinetRequest('POST', '/entries/restore', { recovery_token: recoveryToken }, opts)
}

/**
 * 永久确认可恢复删除（丢弃 recovery token）。
 * @param {string} recoveryToken token
 * @param {{ cabinetId?: string }} [opts] 覆盖（不带 unlock）
 * @returns {Promise<any>} 确认结果
 */
export function finalizeDelete(recoveryToken, opts = {}) {
	return cabinetRequest('POST', '/entries/finalize-delete', { recovery_token: recoveryToken }, {
		...opts,
		unlock: undefined,
	})
}
