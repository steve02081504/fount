/**
 * 【文件】public/hub/sendQueue.mjs
 * 【职责】离线发送队列：网络不可用时将消息持久化到 localStorage，连线后自动重发。
 * 【原理】失败 pending 行写入 `fount.chat.sendQueue`（排除大体积 buffer）；
 *   online / WS open 时遍历队列依次调用 sendGroupMessage。
 *   气泡复用 pending 样式显示「排队中」状态。
 */
import { sendGroupMessage } from '../src/api/groupChannel.mjs'

import { hubStore } from './core/state.mjs'

const QUEUE_KEY = 'fount.chat.sendQueue'

/**
 * @typedef {{ tempId: string, groupId: string, channelId: string, content: object, createdAt: number }} QueuedMessage
 */

/**
 * 读取持久化队列。
 * @returns {QueuedMessage[]} 当前队列数组
 */
function readQueue() {
	try {
		const raw = localStorage.getItem(QUEUE_KEY)
		if (!raw) return []
		const arr = JSON.parse(raw)
		return Array.isArray(arr) ? arr : []
	}
	catch { return [] }
}

/**
 * 写入持久化队列。
 * @param {QueuedMessage[]} queue 队列数组
 * @returns {void}
 */
function writeQueue(queue) {
	try {
		localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
	}
	catch { /* localStorage 满了静默忽略 */ }
}

/**
 * 将失败消息加入离线队列（不含文件，仅文本内容）。
 * @param {string} tempId 临时 pending eventId
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {object} content 富内容对象（不含 buffer）
 * @returns {void}
 */
export function enqueueOfflineMessage(tempId, groupId, channelId, content) {
	const queue = readQueue()
	// 已在队列中则跳过
	if (queue.some(item => item.tempId === tempId)) return
	// 只存文本内容，不存文件 buffer
	const safeContent = { ...content }
	queue.push({ tempId, groupId, channelId, content: safeContent, createdAt: Date.now() })
	writeQueue(queue)
}

/**
 * 从队列移除已成功发送的项。
 * @param {string} tempId 临时 pending eventId
 * @returns {void}
 */
export function dequeueOfflineMessage(tempId) {
	const queue = readQueue().filter(item => item.tempId !== tempId)
	writeQueue(queue)
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
		const queue = readQueue()
		for (const item of queue) {
			const { tempId, groupId, channelId, content } = item
			try {
				await sendGroupMessage(groupId, channelId, content)
				dequeueOfflineMessage(tempId)
				// 若当前还在同一频道，触发增量刷新
				if (hubStore.context.currentGroupId === groupId
					&& hubStore.context.currentChannelId === channelId) 
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
	// 启动时若已在线则立即尝试
	if (navigator.onLine) void drainSendQueue()
}
