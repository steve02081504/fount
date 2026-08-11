/**
 * 人类可读字节大小（1024 进制）。
 * @param {number} bytes 字节数
 * @param {number} [decimals=2] 小数位
 * @returns {string} 如 `1.5 MB`
 */
export function formatBytes(bytes, decimals = 2) {
	if (bytes <= 0) return '0 Bytes'
	const base = 1024
	const fractionDigits = decimals < 0 ? 0 : decimals
	const units = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB']
	const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(base)))
	return `${Number.parseFloat((bytes / base ** unitIndex).toFixed(fractionDigits))} ${units[unitIndex]}`
}
