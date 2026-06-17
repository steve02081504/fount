import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { isHex64 } from '../hexIds.mjs'
import { getNodeDir } from '../node/instance.mjs'

/**
 * @returns {string} `{nodeDir}/chunks`
 */
export function chunkStoreRoot() {
	return path.join(getNodeDir(), 'chunks')
}

/**
 * @param {string} hash 64 hex ciphertextHash
 * @returns {string} 块文件绝对路径
 */
export function chunkStorePath(hash) {
	const chunkHash = String(hash).trim().toLowerCase()
	if (!isHex64(chunkHash)) throw new Error('invalid chunk hash')
	return path.join(chunkStoreRoot(), chunkHash.slice(0, 2), `${chunkHash}.bin`)
}

/**
 * @param {string} hashOrLegacy 64 hex 块哈希，或遗留 username（与 hashMaybe 联用）
 * @param {string} [hashMaybe] 当第一参数为 username 时的块哈希
 * @returns {string} 解析后的 64 hex
 */
function resolveChunkHash(hashOrLegacy, hashMaybe) {
	return hashMaybe ?? hashOrLegacy
}

/**
 * @param {string} hashOrLegacy 64 hex 或遗留 username
 * @param {string} [hashMaybe] 块哈希
 * @returns {Promise<boolean>} 本地是否存在
 */
export async function hasChunk(hashOrLegacy, hashMaybe) {
	const hash = resolveChunkHash(hashOrLegacy, hashMaybe)
	try {
		await fsp.access(chunkStorePath(hash))
		return true
	}
	catch {
		return false
	}
}

/**
 * @param {string} hashOrLegacy 64 hex 或遗留 username
 * @param {string} [hashMaybe] 块哈希
 * @returns {Promise<Buffer>} 块字节
 */
export async function getChunk(hashOrLegacy, hashMaybe) {
	const hash = resolveChunkHash(hashOrLegacy, hashMaybe)
	return fsp.readFile(chunkStorePath(hash))
}

/**
 * @param {string} hash 64 hex
 * @returns {import('node:fs').ReadStream} 可读流
 */
export function createChunkReadStream(hash) {
	return fs.createReadStream(chunkStorePath(hash))
}

/**
 * @param {string} hashOrLegacy 64 hex 或遗留 username
 * @param {string | Buffer | Uint8Array} hashOrData 块哈希或（username 时）块数据
 * @param {Buffer | Uint8Array} [dataMaybe] 块数据
 * @returns {Promise<void>}
 */
export async function putChunk(hashOrLegacy, hashOrData, dataMaybe) {
	const hash = dataMaybe != null ? hashOrData : hashOrLegacy
	const data = dataMaybe ?? hashOrData
	const filePath = chunkStorePath(hash)
	await fsp.mkdir(path.dirname(filePath), { recursive: true })
	await fsp.writeFile(filePath, Buffer.from(data))
}

/**
 * @param {string} hash 64 hex
 * @param {import('node:stream').Readable} readable 密文流
 * @returns {Promise<void>}
 */
export async function putChunkFromStream(hash, readable) {
	const filePath = chunkStorePath(hash)
	await fsp.mkdir(path.dirname(filePath), { recursive: true })
	const writable = fs.createWriteStream(filePath)
	await pipeline(readable, writable)
}

/**
 * @param {string} hash 64 hex
 * @returns {Readable} chunk 可读流
 */
export function chunkToReadable(hash) {
	return createChunkReadStream(hash)
}
