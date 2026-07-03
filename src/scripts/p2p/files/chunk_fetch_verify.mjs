import { sha256Hex } from '../crypto.mjs'
import { isHex64 } from '../hexIds.mjs'

/**
 * @param {string} chunkHash 期望的 64 hex 密文哈希
 * @param {Uint8Array | Buffer | null | undefined} data 块字节
 * @returns {boolean} 是否与 hash 一致
 */
export function chunkBytesMatchHash(chunkHash, data) {
	const hash = String(chunkHash || '').trim().toLowerCase()
	if (!isHex64(hash) || !data?.byteLength) return false
	return sha256Hex(data) === hash
}

/**
 * @param {string} chunkHash 期望哈希
 * @param {Uint8Array | Buffer} data 块字节
 * @returns {Uint8Array | null} 校验通过的数据；否则 null
 */
export function verifiedChunkBytes(chunkHash, data) {
	if (!chunkBytesMatchHash(chunkHash, data)) return null
	return data instanceof Uint8Array ? data : new Uint8Array(data)
}
