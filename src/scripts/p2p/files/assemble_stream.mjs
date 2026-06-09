import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

import { FEDERATION_CHUNK_MAX_BYTES } from '../constants.mjs'
import {
	encryptConvergentPlaintext,
	encryptRandomPlaintext,
} from '../key_crypto.mjs'

import { decryptPart } from './transfer_key.mjs'

/**
 * @typedef {import('./manifest.mjs').CeMode} CeMode
 * @typedef {{ hash: string, size: number, raw: Buffer }} EncryptedPart
 */

/**
 * 从可读流分块加密并流式落盘（每块经 onPart 回调）。
 * @param {import('node:stream').Readable} readable 明文流
 * @param {CeMode} [ceMode] 加密模式
 * @param {(part: EncryptedPart) => Promise<void>} onPart 每块回调
 * @param {number} [maxBytes] 最大字节
 * @returns {Promise<{ contentHash: string, parts: Array<{ hash: string, size: number }>, contentKey?: Buffer }>} 分块结果
 */
export async function encryptReadableToParts(readable, ceMode = 'convergent', onPart, maxBytes = Infinity) {
	const digest = createHash('sha256')
	/** @type {Buffer[]} */
	let pending = Buffer.alloc(0)
	/** @type {Array<{ hash: string, size: number }>} */
	const parts = []
	let contentKey = null
	let total = 0

	/**
	 * @param {Buffer} slice 明文块
	 * @returns {Promise<void>}
	 */
	const flushSlice = async (slice) => {
		digest.update(slice)
		const enc = ceMode === 'random'
			? encryptRandomPlaintext(slice)
			: encryptConvergentPlaintext(slice)
		if (ceMode === 'random') contentKey = enc.contentKey
		const part = { hash: enc.ciphertextHash, size: enc.raw.length, raw: enc.raw }
		parts.push({ hash: part.hash, size: part.size })
		await onPart(part)
	}

	for await (const chunk of readable) {
		const buf = Buffer.from(chunk)
		total += buf.length
		if (total > maxBytes)
			throw new Error('plaintext exceeds max upload size')
		pending = Buffer.concat([pending, buf])
		while (pending.length >= FEDERATION_CHUNK_MAX_BYTES) {
			const slice = pending.subarray(0, FEDERATION_CHUNK_MAX_BYTES)
			pending = pending.subarray(FEDERATION_CHUNK_MAX_BYTES)
			await flushSlice(slice)
		}
	}

	if (pending.length)
		await flushSlice(pending)

	return {
		contentHash: digest.digest('hex'),
		parts,
		contentKey: contentKey || undefined,
	}
}

/**
 * 将 manifest 各密文块解密后串联为可读流。
 * @param {import('./manifest.mjs').FileManifest} manifest manifest
 * @param {import('node:stream').Readable[]} partStreams 按序密文流
 * @param {Buffer | null} contentKey random 密钥
 * @returns {Readable} 明文流
 */
export function createManifestPlaintextStream(manifest, partStreams, contentKey) {
	let partIndex = 0
	let currentStream = null
	const digest = createHash('sha256')

	return new Readable({
		/**
		 *
		 */
		async read() {
			try {
				while (true) {
					if (!currentStream) {
						if (partIndex >= partStreams.length) {
							this.push(null)
							return
						}
						currentStream = partStreams[partIndex++]
					}
					const chunk = currentStream.read()
					if (chunk === null) {
						currentStream = await new Promise((resolve, reject) => {
							currentStream.once('end', () => resolve(null))
							currentStream.once('error', reject)
							currentStream.resume()
						})
						if (currentStream === null) {
							currentStream = null
							continue
						}
					}
					if (chunk?.length) {
						const plain = decryptPart(Buffer.from(chunk), manifest, contentKey)
						if (!plain) {
							this.destroy(new Error('decrypt failed'))
							return
						}
						digest.update(plain)
						if (!this.push(plain))
							return
						return
					}
				}
			}
			catch (error) {
				this.destroy(error instanceof Error ? error : new Error(String(error)))
			}
		},
	})
}
