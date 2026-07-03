import { randomUUID } from 'node:crypto'

/**
 * @param {string} prefix ID 前缀（如 channel_）
 * @returns {string} 带前缀的随机 ID
 */
export function prefixedRandomId(prefix) {
	return `${prefix}${randomUUID().replace(/-/g, '')}`
}
