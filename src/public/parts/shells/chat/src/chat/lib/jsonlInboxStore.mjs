/**
 * append-only JSONL inbox 骨架：dir / append / seenAt / cursor 去重分页。
 * Chat mention inbox 与 Social 通知 inbox 共用；域逻辑自留。
 */
import fs from 'node:fs'
import { join } from 'node:path'

import { appendJsonlSynced, readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'

import { loadJsonFileIfExists, saveJsonFile } from '../../../../../../../scripts/json_loader.mjs'

/**
 * @param {string} rootDir 收件人 inbox 根目录
 * @returns {{
 *   dir: string,
 *   eventsPath: string,
 *   readPath: string,
 *   getSeenAt: () => number,
 *   setSeenAt: (at: number) => void,
 *   append: (row: object) => Promise<void>,
 *   listPage: (options: object) => Promise<{ items: object[], nextCursor: string | null, unreadCount: number }>,
 * }} store
 */
export function createJsonlInboxStore(rootDir) {
	const dir = String(rootDir || '')
	const eventsPath = join(dir, 'events.jsonl')
	const readPath = join(dir, 'read.json')

	/**
	 * @returns {number} 已读水位
	 */
	function getSeenAt() {
		return Number(loadJsonFileIfExists(readPath)?.seenAt) || 0
	}

	/**
	 * @param {number} at 水位
	 * @returns {void}
	 */
	function setSeenAt(at) {
		fs.mkdirSync(dir, { recursive: true })
		saveJsonFile(readPath, { seenAt: Number(at) || Date.now() })
	}

	/**
	 * @param {object} row 行
	 * @returns {Promise<void>}
	 */
	async function append(row) {
		fs.mkdirSync(dir, { recursive: true })
		await appendJsonlSynced(eventsPath, row)
	}

	/**
	 * @param {object} [options] 分页
	 * @param {number} [options.limit] 页大小
	 * @param {string | null} [options.cursor] 游标
	 * @param {(row: object) => string} options.rowCursor 去重键；未提供 pageCursor 时亦作分页游标
	 * @param {(row: object) => string} [options.pageCursor] 变换后分页游标
	 * @param {(rows: object[]) => object[]} [options.transform] 去重后变换（如聚合）
	 * @param {(row: object) => boolean} [options.filter] 行过滤
	 * @param {boolean} [options.sortByAtDesc=true] 是否按 at 降序
	 * @returns {Promise<{ items: object[], nextCursor: string | null, unreadCount: number }>} 页
	 */
	async function listPage(options = {}) {
		const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100)
		const cursor = options.cursor ? String(options.cursor) : null
		const rowCursor = options.rowCursor
		const pageCursor = options.pageCursor || rowCursor
		const transform = options.transform || (rows => rows)
		const filter = options.filter || (() => true)
		const sortByAtDesc = options.sortByAtDesc !== false
		const seenAt = getSeenAt()
		const rows = await readJsonl(eventsPath).catch(() => [])
		const deduped = []
		const seen = new Set()
		const ordered = sortByAtDesc
			? [...rows].sort((left, right) => Number(right.at) - Number(left.at))
			: rows
		for (const row of ordered) {
			if (!filter(row)) continue
			const key = rowCursor(row)
			if (seen.has(key)) continue
			seen.add(key)
			deduped.push(row)
		}
		const items = transform(deduped)
		let startIndex = 0
		if (cursor) {
			startIndex = items.findIndex(row => pageCursor(row) === cursor) + 1
			if (startIndex <= 0) startIndex = items.length
		}
		const page = items.slice(startIndex, startIndex + limit)
		const nextCursor = page.length === limit && startIndex + limit < items.length
			? pageCursor(page[page.length - 1])
			: null
		const unreadCount = items.filter(row => Number(row.at) > seenAt).length
		return { items: page, nextCursor, unreadCount }
	}

	return { dir, eventsPath, readPath, getSeenAt, setSeenAt, append, listPage }
}
