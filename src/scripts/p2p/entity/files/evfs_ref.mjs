import { isEntityHash128 } from '../../entity_id.mjs'
import { assertSafeEvfsLogicalPath } from '../../evfs_logical_path.mjs'

/**
 *
 */
export const EVFS_SCHEME = 'evfs:'

/**
 * @param {string} entityHash 128 hex
 * @param {string} logicalPath EVFS 路径
 * @returns {string} evfs URI 引用
 */
export function formatEvfsRef(entityHash, logicalPath) {
	const eh = String(entityHash).trim().toLowerCase()
	const safePath = assertSafeEvfsLogicalPath(logicalPath)
	return `${EVFS_SCHEME}//${eh}/${safePath}`
}

/**
 * @param {string} ref evfs URI
 * @returns {{ entityHash: string, logicalPath: string } | null} 解析结果；非法为 null
 */
export function parseEvfsRef(ref) {
	if (typeof ref !== 'string' || !ref.startsWith(EVFS_SCHEME)) return null
	try {
		const url = new URL(ref)
		if (url.protocol !== 'evfs:') return null
		const entityHash = String(url.hostname || '').trim().toLowerCase()
		const logicalPath = String(url.pathname || '').replace(/^\/+/, '')
		if (!isEntityHash128(entityHash)) return null
		return { entityHash, logicalPath: assertSafeEvfsLogicalPath(logicalPath) }
	}
	catch {
		return null
	}
}
