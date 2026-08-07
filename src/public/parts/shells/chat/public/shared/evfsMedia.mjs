/**
 * EVFS 媒体 URL 纯函数（Deno-pure；无 fetch）。
 * HTTP 上传/下载见 `/scripts/endpoints/p2p/evfsMedia.mjs`。
 */

const CHAT_SHELL_API_PREFIX = '/api/parts/shells:chat'

/**
 * @param {string} entityHash owner
 * @param {string} logicalPath EVFS 路径
 * @returns {string} 文件 URL
 */
export function entityFileUrl(entityHash, logicalPath) {
	const path = logicalPath.trim().replace(/^\/+/, '')
	return `${CHAT_SHELL_API_PREFIX}/entities/${encodeURIComponent(entityHash)}/files/${path.split('/').map(encodeURIComponent).join('/')}`
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
