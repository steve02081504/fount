/**
 * 浏览器端 EVFS 媒体（Chat / Social 共用）。
 */

const CHAT_SHELL_API_PREFIX = '/api/parts/shells:chat'

/**
 * @returns {Promise<string | null>} viewer entityHash
 */
export async function getViewerEntityHash() {
	const resp = await fetch(`${CHAT_SHELL_API_PREFIX}/viewer`, { credentials: 'include' })
	if (!resp.ok) throw new Error(`viewer ${resp.status}`)
	const data = await resp.json()
	return data.viewerEntityHash
}

/**
 * @param {string} entityHash owner
 * @param {string} logicalPath EVFS 路径
 * @returns {string} 文件 URL
 */
export function entityFileUrl(entityHash, logicalPath) {
	const path = logicalPath.trim().replace(/^\/+/, '')
	return `${CHAT_SHELL_API_PREFIX}/entities/${encodeURIComponent(entityHash)}/files/${path.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * @param {string} entityHash owner
 * @param {string} logicalPath 路径
 * @param {File | Blob} file 文件
 * @returns {Promise<{ entityHash: string, path: string, url: string }>} 上传结果
 */
export async function uploadEvfsFile(entityHash, logicalPath, file) {
	const url = entityFileUrl(entityHash, logicalPath)
	const res = await fetch(url, {
		method: 'PUT',
		credentials: 'include',
		headers: { 'Content-Type': 'application/octet-stream' },
		body: file,
	})
	if (!res.ok) throw new Error((await res.json()).error || `evfs upload failed: ${res.status}`)
	const { url: resolvedUrl } = await res.json()
	return { entityHash, path: logicalPath, url: resolvedUrl }
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

/**
 * @param {File | Blob} file 文件
 * @param {string} logicalPathPrefix 逻辑路径前缀（如 shells/chat/attachments）
 * @returns {Promise<{ entityHash: string, path: string, url: string }>} 上传结果
 */
export async function uploadEvfsAttachment(file, logicalPathPrefix) {
	const entityHash = await getViewerEntityHash()
	if (!entityHash) throw new Error('identity required for attachments')
	return uploadEvfsFile(entityHash, `${logicalPathPrefix}/${crypto.randomUUID()}`, file)
}

/** 与 `sanitizeHtml.isSafeHtmlUrl` 对齐（本模块保持 Deno-pure，不 import `/scripts`）。 */
const SAFE_MEDIA_URL = /^(https?:|mailto:|tel:|#|\/|about:blank#|fount:)/i

/**
 * @param {string} raw URL
 * @returns {boolean} 是否安全（拒 `//` 协议相对）
 */
function isSafeMediaUrl(raw) {
	return !!raw && !raw.startsWith('//') && SAFE_MEDIA_URL.test(raw)
}

/**
 * @param {{ entityHash?: string, path?: string, url?: string }} ref 媒体引用
 * @returns {string} 下载 URL
 */
export function mediaRefUrl(ref) {
	const raw = String(ref?.url || '').trim()
	if (isSafeMediaUrl(raw)) return raw
	if (ref?.entityHash && ref?.path) return entityFileUrl(ref.entityHash, ref.path)
	throw new Error('invalid media ref')
}
