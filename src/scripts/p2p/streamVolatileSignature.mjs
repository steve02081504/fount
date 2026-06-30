/**
 * VOLATILE 流式分片签名域（§6.4）：`pendingStreamId + chunkSeq + slices`。
 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { keyPairFromSeed, sign, verify } from './crypto.mjs'
import { isHex64, isSignatureHex128 } from './hexIds.mjs'

const CHUNK_DOMAIN = 'fount-volatile-chunk'

/** 入站 stream_chunk 切片数量上限。 */
export const MAX_STREAM_VOLATILE_SLICES = 256

/**
 * @param {unknown} slices 入站切片
 * @returns {object[] | null} 合法切片或 null
 */
export function boundStreamSlices(slices) {
	if (!Array.isArray(slices) || slices.length > MAX_STREAM_VOLATILE_SLICES) return null
	return slices
}

/**
 * @param {string} pendingStreamId 逻辑流 id
 * @param {number} chunkSeq 分片序号（从 1 递增）
 * @param {object[]} slices 差异切片数组
 * @returns {Uint8Array} 验签消息字节
 */
export function streamChunkSignBytes(pendingStreamId, chunkSeq, slices) {
	const streamId = String(pendingStreamId ?? '')
	const sequence = Number.isFinite(Number(chunkSeq)) ? String(chunkSeq) : '0'
	const body = JSON.stringify(slices ?? [])
	return new TextEncoder().encode(`${CHUNK_DOMAIN}\0${streamId}\0${sequence}\0${body}`)
}

/**
 * @param {Uint8Array} bytes 签名域
 * @param {Uint8Array} secretKey 私钥种子（32 字节）
 * @returns {Promise<string>} 128 位 hex 签名
 */
export async function signStreamSignatureHex(bytes, secretKey) {
	const signatureBytes = await sign(bytes, secretKey)
	return Buffer.from(signatureBytes).toString('hex')
}

/**
 * @param {Uint8Array} bytes 签名域
 * @param {string} signatureHex 128 hex 签名
 * @param {string} publicKeyHex 64 hex 公钥
 * @returns {Promise<boolean>} 验签是否通过
 */
export async function verifyStreamSignatureHex(bytes, signatureHex, publicKeyHex) {
	const signature = String(signatureHex || '').trim().toLowerCase()
	const publicKey = String(publicKeyHex || '').trim().toLowerCase()
	if (!isSignatureHex128(signature) || !isHex64(publicKey)) return false
	try {
		return await verify(Buffer.from(signature, 'hex'), bytes, Buffer.from(publicKey, 'hex'))
	}
	catch {
		return false
	}
}

/**
 * 本节点出站 VOLATILE 签名密钥（由用户名 + 联邦口令材料确定性派生）。
 * @param {string} username 用户
 * @param {string} seedMaterial 口令或回退材料
 * @returns {{ publicKey: Uint8Array, secretKey: Uint8Array }} 密钥对
 */
export function streamKeyPairFromUserSeed(username, seedMaterial) {
	const user = String(username ?? '')
	const material = String(seedMaterial ?? '')
	const seed = createHash('sha256').update(`fount-stream-sign\0${user}\0${material}`).digest()
	return keyPairFromSeed(seed)
}
