/**
 * 浏览器端 EVFS 上传/下载辅助。
 */

let cachedViewerEntityHash = null

/**
 * 清理 viewer entityHash 缓存。
 * @returns {void}
 */
export function clearViewerEntityCache() {
	cachedViewerEntityHash = null
}

/**
 * @returns {Promise<string | null>} 当前 viewer entityHash
 */
export async function getViewerEntityHash() {
	if (cachedViewerEntityHash) return cachedViewerEntityHash
	const resp = await fetch('/api/p2p/viewer', { credentials: 'include' })
	if (!resp.ok) throw new Error(`viewer ${resp.status}`)
	const data = await resp.json()
	cachedViewerEntityHash = data.viewerEntityHash || null
	return cachedViewerEntityHash
}

/**
 * @param {string} entityHash 128 hex
 * @param {string} logicalPath EVFS 路径
 * @returns {string} URL
 */
export function entityFileUrl(entityHash, logicalPath) {
	const path = String(logicalPath || '').trim().replace(/^\/+/, '')
	return `/api/p2p/entities/${encodeURIComponent(entityHash)}/files/${path.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * @param {string} entityHash owner
 * @param {string} logicalPath 路径
 * @param {File | Blob} file 文件
 * @param {string} [fieldName] 表单字段
 * @returns {Promise<{ entityHash: string, path: string, url: string }>} 上传结果
 */
export async function uploadEvfsFile(entityHash, logicalPath, file, fieldName = 'file') {
	const body = new FormData()
	body.append(fieldName, file)
	const url = entityFileUrl(entityHash, logicalPath)
	const res = await fetch(url, {
		method: 'PUT',
		credentials: 'include',
		body,
	})
	if (!res.ok) {
		const data = await res.json().catch(() => ({}))
		throw new Error(data.error || `evfs upload failed: ${res.status}`)
	}
	const data = await res.json()
	return {
		entityHash,
		path: logicalPath,
		url: data.url || url,
	}
}

/**
 * @param {string} entityHash owner
 * @param {string} logicalPath 路径
 * @returns {Promise<ArrayBuffer>} 文件字节
 */
export async function fetchEvfsFile(entityHash, logicalPath) {
	const res = await fetch(entityFileUrl(entityHash, logicalPath), { credentials: 'include' })
	if (!res.ok) throw new Error(`evfs fetch failed: ${res.status}`)
	return res.arrayBuffer()
}
