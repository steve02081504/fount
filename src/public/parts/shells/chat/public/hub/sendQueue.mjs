/**
 * 【文件】public/hub/sendQueue.mjs
 * 【职责】离线发送队列：网络不可用时将消息（含附件 Blob）持久化到 IndexedDB，连线后自动重发。
 */
import { sendGroupMessage } from '../src/endpoints/groupChannel.mjs'

import { store } from './core/state.mjs'

const DB_NAME = 'fount.chat.sendQueue'
const STORE_NAME = 'queue'
const DB_VERSION = 1

/** @type {Promise<IDBDatabase> | null} */
let dbOpenPromise = null

/**
 * @typedef {{
 *   tempId: string,
 *   groupId: string,
 *   channelId: string,
 *   content: object,
 *   files?: Array<{ name?: string, mime_type?: string, buffer?: string, description?: string }>,
 *   createdAt: number,
 * }} QueuedMessage
 */

/**
 * @returns {Promise<IDBDatabase>} IndexedDB 句柄
 */
function openDb() {
	dbOpenPromise ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION)
		request.addEventListener('upgradeneeded', () => {
			const db = request.result
			if (!db.objectStoreNames.contains(STORE_NAME))
				db.createObjectStore(STORE_NAME, { keyPath: 'tempId' })
		})
		request.addEventListener('success', () => {
			const db = request.result
			db.addEventListener('versionchange', () => {
				db.close()
				dbOpenPromise = null
			})
			resolve(db)
		})
		request.addEventListener('error', () => {
			dbOpenPromise = null
			reject(request.error)
		})
	})
	return dbOpenPromise
}

/**
 * @template T
 * @param {(objectStore: IDBObjectStore) => IDBRequest} run 事务操作
 * @param {IDBTransactionMode} [mode='readonly'] 模式
 * @returns {Promise<T>} 请求结果
 */
async function withStore(run, mode = 'readonly') {
	const db = await openDb()
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE_NAME, mode)
		const objectStore = transaction.objectStore(STORE_NAME)
		const request = run(objectStore)
		request.addEventListener('success', () => resolve(request.result))
		request.addEventListener('error', () => reject(request.error))
	})
}

/**
 * @returns {Promise<QueuedMessage[]>} 队列快照
 */
async function readQueue() {
	try {
		const rows = await withStore(objectStore => objectStore.getAll())
		return Array.isArray(rows) ? rows : []
	}
	catch {
		return []
	}
}

/**
 * 将失败消息加入离线队列（附件以 base64 存 IndexedDB）。
 * @param {string} tempId 临时 pending eventId
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {object} content 富内容对象
 * @param {object[]} [files] 附件
 * @returns {void}
 */
export function enqueueOfflineMessage(tempId, groupId, channelId, content, files = []) {
	void (async () => {
		const queue = await readQueue()
		if (queue.some(item => item.tempId === tempId)) return
		const entry = {
			tempId,
			groupId,
			channelId,
			content: { ...content },
			files: files.map(file => ({
				name: file.name,
				mime_type: file.mime_type,
				buffer: file.buffer,
				...file.description ? { description: file.description } : {},
			})),
			createdAt: Date.now(),
		}
		await withStore(objectStore => objectStore.put(entry), 'readwrite')
	})().catch(() => { /* IndexedDB 不可用时静默 */ })
}

/**
 * 从队列移除已成功发送的项。
 * @param {string} tempId 临时 pending eventId
 * @returns {void}
 */
export function dequeueOfflineMessage(tempId) {
	void withStore(objectStore => objectStore.delete(tempId), 'readwrite').catch(() => { /* empty */ })
}

let draining = false

/**
 * 尝试发送队列中所有待发消息（幂等，同时最多一次 drain）。
 * @returns {Promise<void>}
 */
export async function drainSendQueue() {
	if (draining) return
	draining = true
	try {
		const queue = await readQueue()
		for (const item of queue) {
			const { tempId, groupId, channelId, content, files } = item
			try {
				await sendGroupMessage(
					groupId,
					channelId,
					content,
					files,
				)
				dequeueOfflineMessage(tempId)
				if (store.context.currentGroupId === groupId
					&& store.context.currentChannelId === channelId)
					void import('./messages/messages.mjs').then(m => m.scheduleChannelIncrementalRefresh({ immediate: true }))
			}
			catch { /* 继续尝试下一条 */ }
		}
	}
	finally { draining = false }
}

/**
 * 绑定 online 事件以自动排空队列。
 * @returns {void}
 */
export function wireSendQueueDrain() {
	window.addEventListener('online', () => { void drainSendQueue() })
	if (navigator.onLine) void drainSendQueue()
}
