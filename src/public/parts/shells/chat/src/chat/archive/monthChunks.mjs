/**
 * 冷归档按月联邦：明文 JSONL 分块（512KiB）serve / pull 组装。
 */
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FEDERATION_CHUNK_MAX_BYTES } from 'npm:@steve02081504/fount-p2p/core/constants'
import { encryptPlaintextToMultiParts } from 'npm:@steve02081504/fount-p2p/files/assemble'
import { putChunk } from 'npm:@steve02081504/fount-p2p/files/chunk_store'
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import {
	digestArchiveMonthBody,
	digestArchiveMonthFile,
	digestArchiveMonthFileLinesOnly,
	expectedMonthDigest,
} from './monthDigest.mjs'

/**
 * @param {Array<{ hash: string, size: number }>} parts 加密分块
 * @returns {Array<{ hash: string, size: number, index: number }>} wire parts
 */
export function wirePartsFromEncParts(parts) {
	return parts.map((part, index) => ({
		hash: String(part.hash).trim().toLowerCase(),
		size: Number(part.size) || 0,
		index,
	}))
}

/**
 * 解析 wire parts 列表。
 * @param {unknown} raw wire 载荷
 * @returns {Array<{ hash: string, size: number, index: number }> | null} 解析结果；非法为 null
 */
export function parseArchiveMonthWireParts(raw) {
	if (!Array.isArray(raw) || !raw.length) return []
	/** @type {Array<{ hash: string, size: number, index: number }>} */
	const out = []
	for (const row of raw) {
		const hash = String(row?.hash ?? '').trim().toLowerCase()
		if (!isHex64(hash)) return null
		const index = Number(row.index)
		if (!Number.isInteger(index) || index < 0) return null
		out.push({ hash, size: Math.max(0, Number(row.size) || 0), index })
	}
	out.sort((a, b) => a.index - b.index)
	for (let i = 0; i < out.length; i++)
		if (out[i].index !== i) return null
	return out
}

/**
 * 流式读取文件并分块加密写入 chunk store（峰值内存 ≈ 单块大小）。
 * @param {string} username replica
 * @param {string} filePath 月 JSONL 路径
 * @returns {Promise<Array<{ hash: string, size: number, raw: Buffer }>>} 加密分块
 */
async function encryptArchiveMonthFileToParts(username, filePath) {
	/** @type {Array<{ hash: string, size: number, raw: Buffer }>} */
	const parts = []
	/** @type {Buffer[]} */
	let chunks = []
	let pendingLength = 0
	const stream = createReadStream(filePath)
	for await (const chunk of stream) {
		chunks.push(chunk)
		pendingLength += chunk.length
		while (pendingLength >= FEDERATION_CHUNK_MAX_BYTES) {
			const merged = Buffer.concat(chunks)
			const slice = merged.subarray(0, FEDERATION_CHUNK_MAX_BYTES)
			const leftover = merged.subarray(FEDERATION_CHUNK_MAX_BYTES)
			chunks = leftover.length > 0 ? [leftover] : []
			pendingLength = leftover.length
			const enc = encryptPlaintextToMultiParts(slice, 'plain')
			for (const part of enc.parts) {
				await putChunk( part.hash, part.raw)
				parts.push(part)
			}
		}
	}
	if (pendingLength > 0) {
		const pending = Buffer.concat(chunks)
		const enc = encryptPlaintextToMultiParts(pending, 'plain')
		for (const part of enc.parts) {
			await putChunk( part.hash, part.raw)
			parts.push(part)
		}
	}
	return parts
}

/**
 * @param {string} username replica
 * @param {string} filePath 月 JSONL 路径
 * @param {string} digest 64 hex 内容 digest
 * @returns {Promise<{ digest: string, parts: Array<{ hash: string, size: number, index: number }> }>} 联邦 meta
 */
export async function prepareArchiveMonthChunkMetaFromPath(username, filePath, digest) {
	const encParts = await encryptArchiveMonthFileToParts(username, filePath)
	return { digest, parts: wirePartsFromEncParts(encParts) }
}

/**
 * 将月 JSONL 切分写入 chunk store，返回联邦 meta。
 * @param {string} username replica
 * @param {string} bodyUtf8 月 JSONL 明文
 * @returns {Promise<{ digest: string, parts: Array<{ hash: string, size: number, index: number }> }>} 联邦 meta
 */
export async function prepareArchiveMonthChunkMeta(username, bodyUtf8) {
	const body = String(bodyUtf8 ?? '')
	const { digest } = digestArchiveMonthBody(body)
	const enc = encryptPlaintextToMultiParts(Buffer.from(body, 'utf8'), 'plain')
	for (const part of enc.parts)
		await putChunk( part.hash, part.raw)
	return { digest, parts: wirePartsFromEncParts(enc.parts) }
}

/**
 * 从磁盘月文件生成联邦 chunk meta（优先 manifest digest，流式加密）。
 * @param {string} username replica
 * @param {string} filePath 月 JSONL 路径
 * @param {object} manifest archive manifest
 * @param {string} channelId 频道
 * @param {string} month `YYYY-MM`
 * @returns {Promise<{ digest: string, parts: Array<{ hash: string, size: number, index: number }> } | null>} meta；失败 null
 */
export async function prepareArchiveMonthChunkMetaForServe(username, filePath, manifest, channelId, month) {
	let digest = expectedMonthDigest(manifest, channelId, month)
	if (!digest) {
		const computed = await digestArchiveMonthFile(filePath)
		if (!computed.digest) return null
		digest = computed.digest
	}
	return prepareArchiveMonthChunkMetaFromPath(username, filePath, digest)
}

/**
 * 流式写入临时文件并校验 digest，避免整月 Buffer.concat OOM。
 * @param {Array<{ hash: string, index: number }>} parts wire parts（已排序）
 * @param {Record<string, Uint8Array | Buffer>} fetched hash → bytes
 * @param {string} expectedDigest 64 hex
 * @returns {Promise<{ digest: string, tmpPath: string } | null>} 临时文件路径；调用方负责 rename/unlink
 */
export async function materializeArchiveMonthToTempFile(parts, fetched, expectedDigest) {
	const sorted = [...parts].sort((a, b) => a.index - b.index)
	const tmpPath = join(tmpdir(), `fount-archive-month-${randomUUID()}.jsonl`)
	const ws = createWriteStream(tmpPath)
	try {
		for (const part of sorted) {
			const buf = Buffer.from(fetched[part.hash] || [])
			if (!await new Promise((resolve, reject) => {
				ws.write(buf, err => err ? reject(err) : resolve(true))
			})) return null
		}
		await new Promise((resolve, reject) => {
			ws.end(err => err ? reject(err) : resolve())
		})
		const digest = await digestArchiveMonthFileLinesOnly(tmpPath)
		if (!digest || digest !== expectedDigest) {
			await unlink(tmpPath).catch(() => {})
			return null
		}
		return { digest, tmpPath }
	}
	catch {
		await unlink(tmpPath).catch(() => {})
		return null
	}
	finally {
		ws.destroy()
	}
}

/**
 * 从 chunk meta 拉块并校验 digest。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} slot 联邦槽
 * @param {{ digest?: string, parts?: Array<{ hash: string, size: number, index: number }>, complete?: boolean }} candidate 候选
 * @returns {Promise<string | null>} 临时文件路径；失败 null
 */
export async function resolveArchiveMonthCandidateBody(username, groupId, slot, candidate) {
	if (candidate.complete !== true) return null
	const digest = String(candidate.digest ?? '').trim().toLowerCase()
	if (!isHex64(digest)) return null
	const parts = candidate.parts ?? []
	if (!parts.length) {
		const emptyDigest = digestArchiveMonthBody('').digest
		return emptyDigest === digest ? '' : null
	}
	const parsed = parseArchiveMonthWireParts(parts)
	if (parsed === null) return null
	const hashes = parsed.map(part => part.hash)
	if (!slot?.getRoster?.()?.length) return null
	const { fetchChunksFromRoster } = await import('../federation/chunks.mjs')
	const { fetched, missing } = await fetchChunksFromRoster(slot, username, groupId, hashes)
	if (missing.length) return null
	const materialized = await materializeArchiveMonthToTempFile(parsed, fetched, digest)
	if (!materialized) return null
	return materialized.tmpPath
}
