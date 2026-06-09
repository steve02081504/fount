import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { data_path } from '../../../server/server.mjs'
import { isHex64 } from '../hexIds.mjs'

/**
 * @param {string} username replica
 * @returns {string} `{userDict}/p2p/chunks`
 */
export function chunkStoreRoot(username) {
	void username
	return path.join(data_path, 'p2p', 'chunks')
}

/**
 * @param {string} username replica
 * @param {string} hash 64 hex ciphertextHash
 * @returns {string} 块文件绝对路径
 */
export function chunkStorePath(username, hash) {
	const chunkHash = String(hash).trim().toLowerCase()
	if (!isHex64(chunkHash)) throw new Error('invalid chunk hash')
	return path.join(chunkStoreRoot(username), chunkHash.slice(0, 2), `${chunkHash}.bin`)
}

/**
 * @param {string} username replica
 * @param {string} hash 64 hex
 * @returns {Promise<boolean>} 本地是否存在
 */
export async function hasChunk(username, hash) {
	try {
		await fsp.access(chunkStorePath(username, hash))
		return true
	}
	catch {
		return false
	}
}

/**
 * @param {string} username replica
 * @param {string} hash 64 hex
 * @returns {Promise<Buffer>} 块字节
 */
export async function getChunk(username, hash) {
	return fsp.readFile(chunkStorePath(username, hash))
}

/**
 * @param {string} username replica
 * @param {string} hash 64 hex
 * @returns {import('node:fs').ReadStream} 可读流
 */
export function createChunkReadStream(username, hash) {
	return fs.createReadStream(chunkStorePath(username, hash))
}

/**
 * @param {string} username replica
 * @param {string} hash 64 hex
 * @param {Buffer | Uint8Array} data 块字节
 * @returns {Promise<void>}
 */
export async function putChunk(username, hash, data) {
	const filePath = chunkStorePath(username, hash)
	await fsp.mkdir(path.dirname(filePath), { recursive: true })
	await fsp.writeFile(filePath, Buffer.from(data))
}

/**
 * @param {string} username replica
 * @param {string} hash 64 hex
 * @param {import('node:stream').Readable} readable 密文流
 * @returns {Promise<void>}
 */
export async function putChunkFromStream(username, hash, readable) {
	const filePath = chunkStorePath(username, hash)
	await fsp.mkdir(path.dirname(filePath), { recursive: true })
	const writable = fs.createWriteStream(filePath)
	await pipeline(readable, writable)
}

/**
 * @param {string} username replica
 * @param {string} hash 64 hex
 * @returns {Readable} chunk 可读流
 */
export function chunkToReadable(username, hash) {
	return createChunkReadStream(username, hash)
}
