/**
 * 人类可读字节大小（1024 进制）。
 * @param {number} bytes 字节数
 * @param {number} [decimals=2] 小数位
 * @returns {string} 如 `1.5 MB`
 */
export function formatBytes(bytes, decimals = 2) {
	const n = Number(bytes)
	if (!Number.isFinite(n) || n <= 0) return '0 Bytes'
	const k = 1024
	const dm = decimals < 0 ? 0 : decimals
	const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB']
	const i = Math.min(sizes.length - 1, Math.floor(Math.log(n) / Math.log(k)))
	return `${Number.parseFloat((n / k ** i).toFixed(dm))} ${sizes[i]}`
}
