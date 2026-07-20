/**
 * @param {Response} response HTTP 响应
 * @returns {Promise<string>} 错误文案
 */
export async function readApiError(response) {
	const text = await response.text()
	try {
		const data = JSON.parse(text)
		return String(data.error || text)
	}
	catch {
		return text || `HTTP ${response.status}`
	}
}

/**
 * 从 `#settings:<groupId>` 解析群组 ID（与 hub `urlHash` 一致支持 encode）。
 * @returns {string | null} 群组 ID；hash 不匹配时为 null
 */
export function parseSettingsGroupIdFromHash() {
	const hash = window.location.hash.slice(1)
	if (!hash.startsWith('settings:')) return null
	const raw = hash.slice('settings:'.length)
	try {
		return decodeURIComponent(raw)
	}
	catch {
		return raw
	}
}

/**
 * 格式化归档文件字节数为可读字符串。
 * @param {number} bytes 字节数
 * @returns {string} 可读大小
 */
export function formatArchiveBytes(bytes) {
	const n = Number(bytes) || 0
	if (n < 1024) return `${n} B`
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
	return `${(n / (1024 * 1024)).toFixed(2)} MB`
}
