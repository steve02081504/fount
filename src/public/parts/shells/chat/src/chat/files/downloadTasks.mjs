/**
 * 群文件分片下载任务（断点续传侧车）。
 */
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { chunkFetchProgress } from '../../../../../../../scripts/p2p/chunk_fetch_scheduler.mjs'
import { writeJsonAtomicSynced } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { groupDir } from '../lib/paths.mjs'

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} fileId 文件 ID
 * @returns {string} 任务 JSON 路径
 */
function taskPath(username, groupId, fileId) {
	const safe = String(fileId).replace(/[^\w.-]/gu, '_')
	return join(groupDir(username, groupId), 'download_tasks', `${safe}.json`)
}

/**
 * @param {object} task 任务体
 * @returns {object} 规范化任务
 */
function normalizeTask(task) {
	const chunks = task?.chunks || {}
	/** @type {Record<string, string>} */
	const normalizedChunks = {}
	for (const [hash, state] of Object.entries(chunks)) {
		const h = String(hash).trim().toLowerCase()
		if (!isHex64(h)) continue
		const s = String(state || 'pending')
		if (['pending', 'inflight', 'done', 'failed'].includes(s))
			normalizedChunks[h] = s
	}
	return {
		fileId: String(task?.fileId || ''),
		contentHash: String(task?.contentHash || '').trim().toLowerCase(),
		totalSize: Number(task?.totalSize) || 0,
		chunks: normalizedChunks,
		updatedAt: Number(task?.updatedAt) || Date.now(),
		seededAt: Number(task?.seededAt) || 0,
		status: ['pending', 'inflight', 'done', 'failed', 'unrecoverable'].includes(task?.status)
			? task.status
			: 'pending',
	}
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} fileId 文件 ID
 * @returns {Promise<object | null>} 任务或 null
 */
export async function loadDownloadTask(username, groupId, fileId) {
	try {
		return normalizeTask(JSON.parse(await readFile(taskPath(username, groupId, fileId), 'utf8')))
	}
	catch {
		return null
	}
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} task 任务
 * @returns {Promise<object>} 已保存任务
 */
export async function saveDownloadTask(username, groupId, task) {
	const path = taskPath(username, groupId, task.fileId)
	await mkdir(dirname(path), { recursive: true })
	const normalized = normalizeTask({ ...task, updatedAt: Date.now() })
	await writeJsonAtomicSynced(path, normalized)
	return normalized
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} fileId 文件 ID
 * @param {string[]} chunkHashes 分片哈希列表
 * @param {{ contentHash?: string, totalSize?: number }} [meta] 元数据
 * @returns {Promise<object>} 任务
 */
export async function ensureDownloadTask(username, groupId, fileId, chunkHashes, meta = {}) {
	const existing = await loadDownloadTask(username, groupId, fileId)
	/** @type {Record<string, string>} */
	const chunks = { ...existing?.chunks || {} }
	for (const hash of chunkHashes) {
		const h = String(hash).trim().toLowerCase()
		if (!isHex64(h)) continue
		if (!chunks[h] || chunks[h] === 'failed') chunks[h] = 'pending'
	}
	return await saveDownloadTask(username, groupId, {
		fileId,
		contentHash: meta.contentHash || existing?.contentHash || '',
		totalSize: meta.totalSize ?? existing?.totalSize ?? 0,
		chunks,
		status: existing?.status === 'unrecoverable' ? 'unrecoverable' : 'pending',
	})
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} fileId 文件 ID
 * @param {string} chunkHash 块哈希
 * @param {'pending' | 'inflight' | 'done' | 'failed'} state 状态
 * @returns {Promise<object | null>} 更新后任务
 */
export async function updateDownloadChunkState(username, groupId, fileId, chunkHash, state) {
	const task = await loadDownloadTask(username, groupId, fileId)
	if (!task) return null
	const h = String(chunkHash).trim().toLowerCase()
	if (!isHex64(h)) return task
	task.chunks[h] = state
	const table = new Map(Object.entries(task.chunks).map(([k, v]) => [k, { state: v, attempts: 0 }]))
	const progress = chunkFetchProgress(table)
	if (progress.failed > 0 && progress.done + progress.failed >= progress.total)
		task.status = progress.done > 0 ? 'failed' : 'unrecoverable'
	else if (progress.done >= progress.total && progress.total > 0)
		task.status = 'done'
	else if (progress.inflight > 0)
		task.status = 'inflight'
	else
		task.status = 'pending'
	return await saveDownloadTask(username, groupId, task)
}

/**
 * @param {object | null} task 任务
 * @returns {{ done: number, total: number, percent: number, status: string }} 进度摘要
 */
export function summarizeDownloadTask(task) {
	if (!task?.chunks) return { done: 0, total: 0, percent: 0, status: 'pending' }
	const table = new Map(Object.entries(task.chunks).map(([k, v]) => [k, { state: v, attempts: 0 }]))
	const progress = chunkFetchProgress(table)
	const percent = progress.total ? Math.floor((progress.done / progress.total) * 100) : 0
	return { ...progress, percent, status: task.status || 'pending', seededAt: Number(task.seededAt) || 0 }
}
