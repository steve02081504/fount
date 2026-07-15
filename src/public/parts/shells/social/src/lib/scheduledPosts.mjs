/**
 * 定时发帖草稿队列（本地 JSONL，到点由 scheduledPostWatcher 正式 commit）。
 */
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

import { loadJsonFileIfExists, saveJsonFile } from '../../../../../../scripts/json_loader.mjs'

import { scheduledPostsPath } from '../paths.mjs'

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @returns {object[]} 待发布列表
 */
export function listScheduledPosts(username, entityHash) {
	const path = scheduledPostsPath(username, entityHash)
	const data = loadJsonFileIfExists(path)
	const rows = Array.isArray(data?.rows) ? data.rows : []
	return rows
		.filter(row => row && typeof row === 'object' && row.scheduledId && row.publishAt)
		.sort((a, b) => Number(a.publishAt) - Number(b.publishAt))
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {object[]} rows 全量覆盖
 * @returns {void}
 */
function saveScheduledPosts(username, entityHash, rows) {
	const path = scheduledPostsPath(username, entityHash)
	fs.mkdirSync(path.replace(/[/\\][^/\\]+$/u, ''), { recursive: true })
	saveJsonFile(path, { rows })
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {object} draft 发帖草稿
 * @param {number} publishAt 未来毫秒时间戳
 * @returns {object} 定时项
 */
export function enqueueScheduledPost(username, entityHash, draft, publishAt) {
	const at = Number(publishAt)
	if (!Number.isFinite(at) || at <= Date.now())
		throw new Error('publishAt must be a future timestamp')
	const rows = listScheduledPosts(username, entityHash)
	const row = {
		scheduledId: randomUUID(),
		publishAt: at,
		createdAt: Date.now(),
		draft: structuredClone(draft),
	}
	rows.push(row)
	saveScheduledPosts(username, entityHash, rows)
	return row
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {string} scheduledId id
 * @returns {object | null} 被移除项
 */
export function cancelScheduledPost(username, entityHash, scheduledId) {
	const id = String(scheduledId || '').trim()
	const rows = listScheduledPosts(username, entityHash)
	const idx = rows.findIndex(row => row.scheduledId === id)
	if (idx < 0) return null
	const [removed] = rows.splice(idx, 1)
	saveScheduledPosts(username, entityHash, rows)
	return removed
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {string} scheduledId id
 * @returns {object | null} 取出项（并从队列删除）
 */
export function takeScheduledPost(username, entityHash, scheduledId) {
	return cancelScheduledPost(username, entityHash, scheduledId)
}
