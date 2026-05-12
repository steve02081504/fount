import fs from 'node:fs'
import path from 'node:path'

/**
 * DAG 事件存储
 * 使用 JSONL 格式存储事件流
 */

const EVENTS_DIR = path.join(process.cwd(), 'data', 'events')

/**
 * 确保目录存在
 * @param {string} dir - 目录路径
 */
function ensureDir(dir) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}
}

/**
 * 获取群组事件文件路径
 * @param {string} groupId - 群组ID
 * @returns {string}
 */
function getEventsPath(groupId) {
	ensureDir(path.join(EVENTS_DIR, groupId))
	return path.join(EVENTS_DIR, groupId, 'events.jsonl')
}

/**
 * 获取频道消息文件路径
 * @param {string} groupId - 群组ID
 * @param {string} channelId - 频道ID
 * @returns {string}
 */
function getMessagesPath(groupId, channelId) {
	ensureDir(path.join(EVENTS_DIR, groupId, 'messages'))
	return path.join(EVENTS_DIR, groupId, 'messages', `${channelId}.jsonl`)
}

/**
 * 追加事件到存储
 * @param {string} groupId - 群组ID
 * @param {object} event - 事件对象
 * @returns {Promise<void>}
 */
export async function appendEvent(groupId, event) {
	const eventsPath = getEventsPath(groupId)
	const line = JSON.stringify(event) + '\n'
	await fs.promises.appendFile(eventsPath, line)
}

/**
 * 追加消息到频道
 * @param {string} groupId - 群组ID
 * @param {string} channelId - 频道ID
 * @param {object} message - 消息对象
 * @returns {Promise<void>}
 */
export async function appendMessage(groupId, channelId, message) {
	const messagesPath = getMessagesPath(groupId, channelId)
	const line = JSON.stringify(message) + '\n'
	await fs.promises.appendFile(messagesPath, line)
}

/**
 * 读取所有事件
 * @param {string} groupId - 群组ID
 * @returns {Promise<Array>}
 */
export async function readEvents(groupId) {
	const eventsPath = getEventsPath(groupId)

	if (!fs.existsSync(eventsPath)) {
		return []
	}

	const content = await fs.promises.readFile(eventsPath, 'utf-8')
	const lines = content.trim().split('\n').filter(line => line.length > 0)

	return lines.map(line => JSON.parse(line))
}

/**
 * 读取频道消息
 * @param {string} groupId - 群组ID
 * @param {string} channelId - 频道ID
 * @param {object} options - 选项
 * @returns {Promise<Array>}
 */
export async function readMessages(groupId, channelId, options = {}) {
	const messagesPath = getMessagesPath(groupId, channelId)

	if (!fs.existsSync(messagesPath)) {
		return []
	}

	const content = await fs.promises.readFile(messagesPath, 'utf-8')
	const lines = content.trim().split('\n').filter(line => line.length > 0)
	let messages = lines.map(line => JSON.parse(line))

	if (options.since) {
		const sinceIndex = messages.findIndex(m => m.id === options.since)
		if (sinceIndex !== -1) {
			messages = messages.slice(sinceIndex + 1)
		}
	}

	if (options.before) {
		const beforeIndex = messages.findIndex(m => m.id === options.before)
		if (beforeIndex !== -1) {
			messages = messages.slice(0, beforeIndex)
		}
	}

	if (options.limit) {
		messages = messages.slice(-options.limit)
	}

	return messages
}

/**
 * 读取增量事件
 * @param {string} groupId - 群组ID
 * @param {string} sinceEventId - 起始事件ID
 * @returns {Promise<Array>}
 */
export async function readEventsSince(groupId, sinceEventId) {
	const events = await readEvents(groupId)

	if (!sinceEventId) {
		return events
	}

	const sinceIndex = events.findIndex(e => e.id === sinceEventId)
	if (sinceIndex === -1) {
		return events
	}

	return events.slice(sinceIndex + 1)
}

/**
 * 获取最后一个事件
 * @param {string} groupId - 群组ID
 * @returns {Promise<object|null>}
 */
export async function getLastEvent(groupId) {
	const events = await readEvents(groupId)
	return events.length > 0 ? events[events.length - 1] : null
}

/**
 * 获取事件数量
 * @param {string} groupId - 群组ID
 * @returns {Promise<number>}
 */
export async function getEventCount(groupId) {
	const eventsPath = getEventsPath(groupId)

	if (!fs.existsSync(eventsPath)) {
		return 0
	}

	const content = await fs.promises.readFile(eventsPath, 'utf-8')
	const lines = content.trim().split('\n').filter(line => line.length > 0)

	return lines.length
}

/**
 * 获取存储统计
 * @param {string} groupId - 群组ID
 * @returns {Promise<object>}
 */
export async function getStorageStats(groupId) {
	const groupDir = path.join(EVENTS_DIR, groupId)

	if (!fs.existsSync(groupDir)) {
		return {
			totalSize: 0,
			eventCount: 0,
			channelCount: 0
		}
	}

	let totalSize = 0
	let eventCount = 0
	let channelCount = 0

	const eventsPath = getEventsPath(groupId)
	if (fs.existsSync(eventsPath)) {
		const stat = fs.statSync(eventsPath)
		totalSize += stat.size
		eventCount = await getEventCount(groupId)
	}

	const messagesDir = path.join(groupDir, 'messages')
	if (fs.existsSync(messagesDir)) {
		const files = fs.readdirSync(messagesDir)
		channelCount = files.length

		for (const file of files) {
			const filePath = path.join(messagesDir, file)
			const stat = fs.statSync(filePath)
			totalSize += stat.size
		}
	}

	return {
		totalSize,
		eventCount,
		channelCount
	}
}
