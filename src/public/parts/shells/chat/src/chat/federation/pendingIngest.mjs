/**
 * 【文件】federation/pendingIngest.mjs
 * 【职责】联邦入站暂时性失败（ACL 快照未就绪、dag_tip_merge 拓扑未对齐）的持久队列；快照/拓扑就绪后重放 ingest。
 * 【原理】enqueuePendingIngest 写入 pending_ingest.jsonl；replayPendingIngestEvents 逐条调用 tryIngest，失败行写回。与 acl.shouldDeferInboundIngest 配对；出站对称见 pendingRelay.mjs。
 * 【数据结构】行 `{ event, reason, pendedAt }`；与 quarantine（HLC/missing_target）独立。
 * 【关联】acl.mjs、remoteIngest.mjs releasePendingIngestEvents、lib/paths.mjs pendingIngestPath。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { debugLog } from '../../../../../../../scripts/debug_log.mjs'
import { readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'
import { pendingIngestPath } from '../lib/paths.mjs'

/** 单群 pending_ingest 最大行数（超出时丢弃最老行）。 */
export const MAX_PENDING_INGEST_ROWS = 1000

/** 入队后超过该毫秒未重放成功则丢弃。 */
export const PENDING_INGEST_TTL_MS = 10 * 60 * 1000

/**
 * @param {object} row 队列行
 * @param {number} nowMs 当前时间戳
 * @returns {boolean} 未过期则为 true
 */
function rowIsFresh(row, nowMs) {
	if (!row?.event?.id) return false
	const pendedAt = Number(row.pendedAt) || 0
	return nowMs - pendedAt < PENDING_INGEST_TTL_MS
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<object[]>} 未过期的队列行
 */
export async function readPendingIngestRows(username, groupId) {
	const nowMs = Date.now()
	const rows = await readJsonl(pendingIngestPath(username, groupId), { sanitize: stripDagEventLocalExtensions })
	return rows.filter(row => rowIsFresh(row, nowMs))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object[]} rows 保留行
 * @returns {Promise<void>}
 */
async function writePendingIngestRows(username, groupId, rows) {
	const path = pendingIngestPath(username, groupId)
	await mkdir(dirname(path), { recursive: true })
	const body = rows.map(JSON.stringify).join('\n')
	await writeFile(path, body ? `${body}\n` : '', 'utf8')
	if (!rows.length) {
		const { unlink } = await import('node:fs/promises')
		await unlink(path).catch(() => {})
	}
}

/**
 * 联邦入站暂时性失败入队。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} signPayload 签名事件
 * @param {string} [reason] 暂缓原因
 * @returns {Promise<void>}
 */
export async function enqueuePendingIngest(username, groupId, signPayload, reason = '') {
	if (!signPayload?.id) return
	const nowMs = Date.now()
	let rows = await readPendingIngestRows(username, groupId)
	if (rows.length >= MAX_PENDING_INGEST_ROWS)
		rows = rows.slice(rows.length - MAX_PENDING_INGEST_ROWS + 1)
	rows.push({
		event: stripDagEventLocalExtensions(signPayload),
		reason: String(reason || ''),
		pendedAt: nowMs,
	})
	await writePendingIngestRows(username, groupId, rows)
	await debugLog('pending-ingest', {
		action: 'enqueue',
		reason: String(reason || ''),
		eventId: signPayload.id,
		count: rows.length,
	}).catch(() => {})
}

/**
 * 拓扑/ACL 就绪后重放 pending_ingest 队列。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {(ev: object) => Promise<import('../dag/remoteIngest.mjs').RemoteIngestResult>} tryIngest 入库函数
 * @returns {Promise<{ released: number, remaining: number }>} 释放条数与剩余条数
 */
export async function replayPendingIngestEvents(username, groupId, tryIngest) {
	const rows = await readPendingIngestRows(username, groupId)
	if (!rows.length) return { released: 0, remaining: 0 }

	/** @type {object[]} */
	const keep = []
	let released = 0
	for (const row of rows) {
		const ev = row?.event
		if (!ev || typeof ev !== 'object') continue
		const status = await tryIngest(ev)
		if (status?.status === 'applied' || status?.status === 'duplicate') {
			released++
			continue
		}
		keep.push(row)
	}
	if (keep.length !== rows.length)
		await writePendingIngestRows(username, groupId, keep)
	await debugLog('pending-ingest', {
		action: 'replay',
		released,
		remaining: keep.length,
	}).catch(() => {})
	return { released, remaining: keep.length }
}
