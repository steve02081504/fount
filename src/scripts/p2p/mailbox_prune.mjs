/**
 * Mailbox 公平淘汰（纯函数，供 store 与单测复用）。
 */
import { normalizeHex64 } from './hexIds.mjs'

/** 单收件人×发送者桶：条数上限 */
export const MAX_BUCKET_ENTRIES = 10
/** 单收件人×发送者桶：字节上限 */
export const MAX_BUCKET_BYTES = 2 * 1024 * 1024
/**
 * 单用户 mailbox 全局条数上限。
 * @type {number}
 */
export const MAX_MAILBOX_ENTRIES = 500
/**
 * 单用户 mailbox 全局字节上限。
 * @type {number}
 */
export const MAX_MAILBOX_BYTES = 50 * 1024 * 1024

/**
 * @param {object} record 记录
 * @returns {number} JSON 序列化字节量
 */
export function mailboxRecordBytes(record) {
	return JSON.stringify(record).length
}

/**
 * @param {object} record 记录
 * @returns {string} 公平淘汰桶键
 */
export function mailboxBucketKey(record) {
	const to = normalizeHex64(record.toPubKeyHash) || ''
	const from = record.fromNodeHash?.trim().toLowerCase()
		|| record.envelope?.sender?.trim().toLowerCase()
		|| 'unknown'
	return `${to}\0${from}`
}

/**
 * @param {object[]} rows 记录列表
 * @returns {object[]} 按桶修剪后
 */
export function pruneMailboxBuckets(rows) {
	/** @type {Map<string, object[]>} */
	const buckets = new Map()
	for (const record of rows) {
		const key = mailboxBucketKey(record)
		const list = buckets.get(key) || []
		list.push(record)
		buckets.set(key, list)
	}
	/** @type {object[]} */
	const out = []
	for (const list of buckets.values()) {
		const bucket = [...list].sort((a, b) => a.storedAt - b.storedAt)
		let bytes = bucket.reduce((sum, record) => sum + mailboxRecordBytes(record), 0)
		while (bucket.length > MAX_BUCKET_ENTRIES || bytes > MAX_BUCKET_BYTES) {
			if (!bucket.length) break
			const removed = bucket.shift()
			bytes -= mailboxRecordBytes(removed)
		}
		out.push(...bucket)
	}
	return out
}

/**
 * @param {object[]} rows 已按桶修剪后的记录
 * @returns {object[]} 全局限额内
 */
export function pruneMailboxGlobalFair(rows) {
	let kept = [...rows].sort((a, b) => a.storedAt - b.storedAt)
	let totalBytes = kept.reduce((sum, record) => sum + mailboxRecordBytes(record), 0)

	while ((kept.length > MAX_MAILBOX_ENTRIES || totalBytes > MAX_MAILBOX_BYTES) && kept.length > 1) {
		/** @type {Map<string, object[]>} */
		const buckets = new Map()
		for (const record of kept) {
			const key = mailboxBucketKey(record)
			const list = buckets.get(key) || []
			list.push(record)
			buckets.set(key, list)
		}
		let victimKey = ''
		let victimScore = -1
		for (const [key, list] of buckets) {
			const score = list.length * 1_000_000 + list.reduce((s, r) => s + mailboxRecordBytes(r), 0)
			if (score > victimScore) {
				victimScore = score
				victimKey = key
			}
		}
		const victimList = buckets.get(victimKey) || []
		if (!victimList.length) break
		victimList.sort((a, b) => a.storedAt - b.storedAt)
		const dropId = victimList[0].id
		kept = kept.filter(record => record.id !== dropId)
		totalBytes = kept.reduce((sum, record) => sum + mailboxRecordBytes(record), 0)
	}

	if (kept.length > MAX_MAILBOX_ENTRIES)
		kept = kept.slice(-MAX_MAILBOX_ENTRIES)
	return kept
}
