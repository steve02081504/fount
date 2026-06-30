/** 浏览器端 evfs: 引用解析（与 `scripts/p2p/entity/files/evfs_ref.mjs` 一致）。 */
import { isEntityHash128 } from './entityHash.mjs'

/** @type {string} */
export const EVFS_SCHEME = 'evfs:'

/**
 * @param {string} logicalPath EVFS 逻辑路径
 * @returns {string} 规范化后的相对路径
 */
function assertSafeEvfsLogicalPath(logicalPath) {
	const raw = String(logicalPath || '').trim()
	if (!raw || raw.includes('\0'))
		throw new Error('invalid EVFS path')
	const segments = raw.split(/[/\\]+/).map(s => s.trim()).filter(Boolean)
	if (!segments.length) throw new Error('invalid EVFS path')
	for (const segment of segments)
		if (segment === '.' || segment === '..')
			throw new Error('invalid EVFS path traversal')
	return segments.join('/')
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
