/**
 * 浏览器端 EVFS 媒体 HTTP（Chat / Social 共用）。
 * URL 纯函数见 `/parts/shells:chat/shared/evfsMedia.mjs`。
 */
import { entityFileUrl, mediaRefUrl } from '/parts/shells:chat/shared/evfsMedia.mjs'

/** 再导出 EVFS 文件 URL / mediaRef URL 纯函数（实现见 chat shared）。 */
export { entityFileUrl, mediaRefUrl }

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
 * @returns {Promise<{ buffer: ArrayBuffer, mimeType: string }>} 文件字节与 Content-Type
 */
export async function fetchEvfsFile(entityHash, logicalPath) {
	const res = await fetch(entityFileUrl(entityHash, logicalPath), { credentials: 'include' })
	if (!res.ok) throw new Error(`evfs fetch failed: ${res.status}`)
	return {
		buffer: await res.arrayBuffer(),
		mimeType: res.headers.get('Content-Type') || 'application/octet-stream',
	}
}

/**
 * 按 mediaRef（url 或 entityHash+path）下载字节。
 * @param {{ entityHash?: string, path?: string, url?: string, mimeType?: string }} ref 媒体引用
 * @returns {Promise<{ buffer: ArrayBuffer, mimeType: string }>} 文件字节与 Content-Type
 */
export async function fetchMediaRef(ref) {
	if (ref?.entityHash && ref?.path && !ref.url)
		return fetchEvfsFile(ref.entityHash, ref.path)
	const res = await fetch(mediaRefUrl(ref), { credentials: 'include' })
	if (!res.ok) throw new Error(`mediaRef fetch failed: ${res.status}`)
	return {
		buffer: await res.arrayBuffer(),
		mimeType: String(ref?.mimeType || res.headers.get('Content-Type') || 'application/octet-stream'),
	}
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
