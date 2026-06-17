/**
 * 【文件】`events/meta.mjs` — DAG 事件本地验收时间侧车。
 * 【职责】记录本节点收到各 `eventId` 的 `receivedAt`（毫秒），供频道消息行与 UI 展示；不进入 DAG canonical。
 * 【原理】与联邦 wire 剥离字段一致：`receivedAt` 仅存 `event_meta.json` 侧车，避免污染跨节点复制的 events.jsonl。
 * 【数据结构】`EventMetaFile`: `{ receivedAt: Record<eventId, number> }`；超 5 万条时裁剪最旧条目。
 * 【关联】`append.mjs`、`remoteIngest.mjs`、`eventPersist.mjs`、`p2p/dag/strip_extensions.mjs`、`../lib/paths.mjs`。
 */
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { writeJsonAtomic } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { eventMetaPath } from '../lib/paths.mjs'

/**
 * @typedef {{ receivedAt: Record<string, number> }} EventMetaFile
 */

/**
 * @param {unknown} raw 磁盘 JSON
 * @returns {EventMetaFile} 规范化后的元数据对象
 */
function normalizeMeta(raw) {
	return { receivedAt: raw?.receivedAt ?? {} }
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<EventMetaFile>} 侧车元数据
 */
export async function loadEventMeta(username, groupId) {
	const p = eventMetaPath(username, groupId)
	try {
		return normalizeMeta(JSON.parse(await readFile(p, 'utf8')))
	}
	catch {
		return normalizeMeta(null)
	}
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {EventMetaFile} data 元数据
 * @returns {Promise<void>}
 */
async function saveEventMeta(username, groupId, data) {
	const p = eventMetaPath(username, groupId)
	await mkdir(dirname(p), { recursive: true })
	await writeJsonAtomic(p, normalizeMeta(data))
}

/**
 * 记录本节点验收时间（不入 DAG canonical）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} eventId 事件 id
 * @param {number} [t] 毫秒时间戳，默认 `Date.now()`
 * @returns {Promise<void>}
 */
export async function recordEventReceivedAt(username, groupId, eventId, t = Date.now()) {
	const id = String(eventId).trim().toLowerCase()
	if (!id) return
	const meta = await loadEventMeta(username, groupId)
	meta.receivedAt[id] = Math.floor(t)
	const keys = Object.keys(meta.receivedAt)
	if (keys.length > 50_000) {
		const sorted = keys.sort((a, b) => (meta.receivedAt[a] || 0) - (meta.receivedAt[b] || 0))
		for (const k of sorted.slice(0, keys.length - 40_000)) delete meta.receivedAt[k]
	}
	await saveEventMeta(username, groupId, meta)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} eventId 事件 id
 * @returns {Promise<number | undefined>} 本地验收时间
 */
export async function getEventReceivedAt(username, groupId, eventId) {
	const id = String(eventId).trim().toLowerCase()
	if (!id) return undefined
	const meta = await loadEventMeta(username, groupId)
	const n = meta.receivedAt[id]
	return Number.isFinite(n) ? n : undefined
}
