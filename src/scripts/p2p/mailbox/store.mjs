import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { jsonlMutexKey, writeJsonl } from '../dag/storage.mjs'
import { isHex64, normalizeHex64 } from '../hexIds.mjs'
import {
	defaultTtlMsForTier,
	sortMailboxForRetention,
} from '../mailbox_importance.mjs'
import {
	MAX_BUCKET_BYTES,
	MAX_BUCKET_ENTRIES,
	mailboxBucketKey,
	mailboxRecordBytes,
	pruneMailboxBuckets,
	pruneMailboxGlobalFair,
} from '../mailbox_prune.mjs'
import { mailboxStorePath } from '../user_paths.mjs'
import { withAsyncMutex } from '../utils/async_mutex.mjs'

/**
 *
 */
export { MAX_BUCKET_BYTES, MAX_BUCKET_ENTRIES, mailboxBucketKey, mailboxRecordBytes }

/** 单条 mailbox envelope JSON 字节上限 */
export const MAX_ENTRY_BYTES = 256 * 1024

/**
 * @typedef {'trusted' | 'normal' | 'quarantine'} MailboxTier
 */

/**
 * @typedef {{
 *   id: string,
 *   app: string,
 *   toPubKeyHash: string,
 *   dmSessionTag?: string,
 *   groupId?: string,
 *   channelId?: string,
 *   envelope: object,
 *   storedAt: number,
 *   expiresAt: number,
 *   fromNodeHash: string,
 *   hop: number,
 *   tier?: MailboxTier,
 *   importance?: number,
 * }} MailboxRecord
 */

/**
 * @param {unknown} value 入站 hop
 * @returns {number} 非负整数 hop
 */
export function normalizeMailboxHop(value) {
	const n = Number(value)
	if (!Number.isFinite(n)) return 0
	return Math.max(0, Math.floor(n))
}

/**
 * @returns {string} mailbox store 进程内互斥键
 */
function mailboxStoreMutexKey() {
	return jsonlMutexKey(mailboxStorePath())
}

/**
 * @param {number} hop 转发跳数
 * @returns {MailboxTier} 信誉分层
 */
export function mailboxTierFromHop(hop) {
	if (hop <= 0) return 'trusted'
	if (hop === 1) return 'normal'
	return 'quarantine'
}

/**
 * @param {object | null | undefined} row mailbox 记录
 * @returns {boolean} 是否可交给 Part 消费者（排除 quarantine 与缺字段）
 */
export function isDeliverableMailboxRecord(row) {
	if (!row?.envelope || typeof row.envelope !== 'object') return false
	if (!String(row.app || '').trim()) return false
	return row.tier === 'trusted' || row.tier === 'normal'
}

/**
 * @param {object | null | undefined} record mailbox 记录
 * @returns {boolean} envelope 是否在存储限额内
 */
export function isMailboxRecordWithinSizeLimit(record) {
	if (!record?.envelope || typeof record.envelope !== 'object') return false
	return JSON.stringify(record.envelope).length <= MAX_ENTRY_BYTES
}

/**
 * 入站 wire 转发：不信任自报 hop，至少为 1；若本地已有同 id 则单调递增。
 * @param {unknown} wireHop 线载荷 hop
 * @param {unknown} [existingStoredHop] 本地已存 hop
 * @returns {number} 本节点存储 hop
 */
export function relayHopAfterWireIngress(wireHop, existingStoredHop) {
	const fromWire = Math.max(normalizeMailboxHop(wireHop) + 1, 1)
	if (existingStoredHop == null || !Number.isFinite(Number(existingStoredHop)))
		return fromWire
	return Math.max(fromWire, normalizeMailboxHop(existingStoredHop) + 1)
}

/**
 * @returns {Promise<MailboxRecord[]>} 全部有效记录
 */
async function readAll() {
	try {
		const text = await readFile(mailboxStorePath(), 'utf8')
		/** @type {MailboxRecord[]} */
		const rows = []
		for (const line of text.split('\n')) {
			const trimmed = line.trim()
			if (!trimmed) continue
			try {
				rows.push(JSON.parse(trimmed))
			}
			catch { /* skip corrupt line */ }
		}
		return rows
	}
	catch { return [] }
}

/**
 * @param {MailboxRecord[]} rows 待写入记录
 * @returns {Promise<void>}
 */
async function writeAll(rows) {
	const filePath = mailboxStorePath()
	await mkdir(dirname(filePath), { recursive: true })
	const now = Date.now()
	const kept = pruneMailboxGlobalFair(
		pruneMailboxBuckets(sortMailboxForRetention(rows.filter(record => record.expiresAt > now))),
	)
	await writeJsonl(filePath, kept)
}

/**
 * @param {object} envelope 载荷
 * @returns {string} 稳定信封 id
 */
export function mailboxEnvelopeId(envelope) {
	const id = String(envelope?.id || '').trim().toLowerCase()
	if (!id) throw new Error('mailbox envelope id required')
	return id
}

/**
 * @param {object} record mailbox 记录字段
 * @returns {Promise<boolean>} 是否新写入
 */
export async function storeMailboxRecord(record) {
	if (!isMailboxRecordWithinSizeLimit(record)) return false
	const toPubKeyHash = normalizeHex64(record.toPubKeyHash)
	if (!isHex64(toPubKeyHash)) return false
	const hop = normalizeMailboxHop(record.hop)
	const tier = record.tier
	if (!['trusted', 'normal', 'quarantine'].includes(tier)) return false
	const app = String(record.app || '').trim()
	if (!app) return false
	let id
	try {
		id = mailboxEnvelopeId(record.envelope)
	}
	catch {
		return false
	}
	return withAsyncMutex(mailboxStoreMutexKey(), async () => {
		const rows = await readAll()
		if (rows.some(row => row.id === id)) return false
		const ttlMs = Number(record.ttlMs) || defaultTtlMsForTier(tier)
		rows.push({
			id,
			app,
			toPubKeyHash,
			dmSessionTag: record.dmSessionTag?.trim().toLowerCase() || undefined,
			groupId: record.groupId || undefined,
			channelId: record.channelId || undefined,
			envelope: record.envelope,
			storedAt: Date.now(),
			expiresAt: Date.now() + ttlMs,
			fromNodeHash: String(record.fromNodeHash || '').trim(),
			hop,
			tier,
			importance: Number.isFinite(Number(record.importance)) ? Number(record.importance) : undefined,
		})
		await writeAll(rows)
		return true
	})
}

/**
 * @param {string} toPubKeyHash 收件人
 * @returns {Promise<string[]>} record id 列表
 */
export async function listMailboxIdsForRecipient(toPubKeyHash) {
	const recipient = normalizeHex64(toPubKeyHash)
	return (await readAll())
		.filter(record => record.toPubKeyHash === recipient)
		.map(record => record.id)
}

/**
 * @param {string[]} ids record id 列表
 * @returns {Promise<MailboxRecord[]>} 匹配记录
 */
export async function getMailboxRecords(ids) {
	const want = new Set(ids.map(id => String(id).trim().toLowerCase()))
	return (await readAll()).filter(record => want.has(record.id))
}

/**
 * @param {string[]} ids 待删除 id
 * @returns {Promise<void>}
 */
export async function deleteMailboxRecords(ids) {
	const drop = new Set(ids.map(id => String(id).trim().toLowerCase()))
	return withAsyncMutex(mailboxStoreMutexKey(), async () => {
		await writeAll((await readAll()).filter(record => !drop.has(record.id)))
	})
}

/**
 * @param {string} toPubKeyHash 收件人
 * @returns {Promise<MailboxRecord[]>} 待发记录（不删除）
 */
export async function takeMailboxForRecipient(toPubKeyHash) {
	const recipient = normalizeHex64(toPubKeyHash)
	return (await readAll()).filter(record => record.toPubKeyHash === recipient)
}

/**
 * @returns {Promise<number>} 未过期条数
 */
export async function countMailboxPending() {
	const now = Date.now()
	return (await readAll()).filter(record => record.expiresAt > now).length
}
