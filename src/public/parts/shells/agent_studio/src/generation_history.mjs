/**
 * 【文件】generation_history.mjs — 生成历史存储
 * 【职责】记录/查询一次生成（generation）的可观测数据，供 Agent Studio 使用；含两类 TTL 清理与串行落盘。
 * 【原理】按用户落盘 `data/users/<u>/shells/agent_studio/{settings.json,index.json,records/<id>.json}`：
 *   index.json 存列表摘要，records/<id>.json 存完整记录（含 input/response）。`input` 超 promptMs 清除，整条记录超 conversationMs 删除。
 * 【关联】chat triggerReply、plugins/sub-agent 写入；public/shared/generationChain.mjs 纯链函数；events `GenerationRecorded`。
 */
import fs from 'node:fs'
import path from 'node:path'

import { loadJsonFileIfExists, saveJsonFile } from '../../../../../scripts/json_loader.mjs'
import { ms } from '../../../../../scripts/ms.mjs'
import { getUserDictionary } from '../../../../../server/auth/index.mjs'
import { events } from '../../../../../server/events.mjs'
import { conversationKey, summarizeConversations } from '../public/shared/generationChain.mjs'

/**
 * 重导出生成链 / 会话聚合纯函数，供调用方从本模块统一获取。
 */
export { buildChains, conversationKey, groupByConversation, summarizeConversations } from '../public/shared/generationChain.mjs'

/** 默认保留策略：prompt（input）2 天，conversation（整条记录）7 天。 */
export const DEFAULT_RETENTION = {
	promptMs: ms('2d'),
	conversationMs: ms('7d'),
}

/**
 * @typedef {object} generationRecord_t
 * @property {string} id
 * @property {string | null} [parentId]
 * @property {string} charId
 * @property {string} [charname]
 * @property {{ runId?: string, parentRunId?: string, batchId?: string, backgroundId?: string }} [subAgent]
 * @property {string} [chatId]
 * @property {string} [conversationId]
 * @property {string} source
 * @property {number} startedAt
 * @property {number} [finishedAt]
 * @property {any} [input] 请求 chat_log 快照（非组装后 prompt；旧格式兼容字段）
 * @property {object[]} [requests] 逐轮 AI 请求快照 `{ index, startedAt, finishedAt, model, systemPrompt, messages }`
 * @property {number} [requestCount] 采集到的轮次数（requests 被 TTL 清除后仍保留）
 * @property {any} [response]
 * @property {object[]} [conversation] 内部完整对话（子代理运行时；供 Agent Studio 内部对话页）
 * @property {string} [model]
 * @property {object} [metadata]
 * @property {{ name?: string, message?: string }} [error]
 */

/** 每个用户的写入串行队列。 @type {Map<string, Promise<any>>} */
const writeQueues = new Map()
/** 已初始化的用户集合。 @type {Set<string>} */
const initializedUsers = new Set()

/**
 * 串行执行某用户的写入任务。
 * @template T
 * @param {string} username 用户
 * @param {() => Promise<T>} task 任务
 * @returns {Promise<T>} 任务结果
 */
function enqueue(username, task) {
	const previous = writeQueues.get(username) || Promise.resolve()
	const next = previous.then(task, task)
	writeQueues.set(username, next.then(() => { }, () => { }))
	return next
}

/**
 * 用户数据目录。
 * @param {string} username 用户
 * @returns {string} 目录路径
 */
function shellDir(username) {
	return path.join(getUserDictionary(username), 'shells', 'agent_studio')
}

/**
 * @param {string} username 用户
 * @returns {string} settings.json 路径
 */
function settingsPath(username) {
	return path.join(shellDir(username), 'settings.json')
}

/**
 * @param {string} username 用户
 * @returns {string} index.json 路径
 */
function indexPath(username) {
	return path.join(shellDir(username), 'index.json')
}

/**
 * @param {string} username 用户
 * @param {string} id 记录 ID
 * @returns {string} 记录文件路径
 */
function recordPath(username, id) {
	return path.join(shellDir(username), 'records', `${id}.json`)
}

/**
 * 加载保留策略。
 * @param {string} username 用户
 * @returns {{ promptMs: number, conversationMs: number }} 保留策略
 */
function loadRetention(username) {
	const settings = loadJsonFileIfExists(settingsPath(username), {})
	return { ...DEFAULT_RETENTION, ...settings.retention }
}

/**
 * 保存保留策略。
 * @param {string} username 用户
 * @param {object} retention 保留策略
 * @returns {void}
 */
function saveRetention(username, retention) {
	fs.mkdirSync(shellDir(username), { recursive: true })
	const settings = loadJsonFileIfExists(settingsPath(username), {})
	settings.retention = { ...DEFAULT_RETENTION, ...retention }
	saveJsonFile(settingsPath(username), settings)
}

/**
 * @param {string} username 用户
 * @returns {{ records: object[] }} 索引
 */
function loadIndex(username) {
	const index = loadJsonFileIfExists(indexPath(username), { records: [] })
	index.records ??= []
	return index
}

/**
 * @param {string} username 用户
 * @param {{ records: object[] }} index 索引
 * @returns {void}
 */
function saveIndex(username, index) {
	fs.mkdirSync(shellDir(username), { recursive: true })
	saveJsonFile(indexPath(username), index)
}

/**
 * 把完整记录投影为索引摘要。
 * @param {generationRecord_t} record 记录
 * @returns {object} 摘要
 */
function toSummary(record) {
	return {
		id: record.id,
		parentId: record.parentId ?? null,
		charId: record.charId,
		charname: record.charname,
		subAgent: record.subAgent,
		chatId: record.chatId,
		conversationId: record.conversationId,
		source: record.source,
		startedAt: record.startedAt,
		finishedAt: record.finishedAt,
		model: record.model,
		requestCount: record.requestCount ?? record.requests?.length ?? 0,
		hasError: !!record.error,
	}
}

/**
 * 确保用户目录与索引已初始化。
 * @param {string} username 用户
 * @returns {void}
 */
function ensureUser(username) {
	if (initializedUsers.has(username)) return
	fs.mkdirSync(path.join(shellDir(username), 'records'), { recursive: true })
	if (!fs.existsSync(indexPath(username))) saveIndex(username, { records: [] })
	initializedUsers.add(username)
}

/**
 * 应用 TTL：input 超 promptMs 清除；整条记录超 conversationMs 删除。
 * @param {generationRecord_t} record 记录
 * @param {{ promptMs: number, conversationMs: number }} retention 保留策略
 * @param {number} now 当前时间
 * @returns {'keep' | 'strip-input' | 'delete'} 处置
 */
function retentionAction(record, retention, now) {
	const age = now - (record.finishedAt || record.startedAt || 0)
	if (age > retention.conversationMs) return 'delete'
	if (age > retention.promptMs && (record.input !== undefined || record.requests !== undefined)) return 'strip-input'
	return 'keep'
}

/**
 * 清除记录中的 prompt 载荷（旧 `input` 与逐轮 `requests`），保留 `requestCount` 以便提示已过期。
 * @param {generationRecord_t} record 记录（就地修改）
 * @returns {boolean} 是否发生了清除
 */
function stripPromptPayloads(record) {
	let stripped = false
	if (record.input !== undefined) {
		delete record.input
		stripped = true
	}
	if (record.requests !== undefined) {
		record.requestCount ??= record.requests.length
		delete record.requests
		record.requestsStripped = true
		stripped = true
	}
	return stripped
}

/**
 * 清理某用户的过期记录（索引与记录文件）。
 * @param {string} username 用户
 * @param {{ index?: { records: object[] } }} [options] 选项（`index` 为已加载的索引，避免二次读盘）
 * @returns {number} 删除的记录数
 */
export function pruneGenerations(username, { index } = {}) {
	ensureUser(username)
	const retention = loadRetention(username)
	const now = Date.now()
	const loadedIndex = index ?? loadIndex(username)
	const kept = []
	let removed = 0
	for (const summary of loadedIndex.records) {
		const age = now - (summary.finishedAt || summary.startedAt || 0)
		if (age > retention.conversationMs) {
			try { fs.rmSync(recordPath(username, summary.id), { force: true }) } catch { /* 忽略删除失败 */ }
			removed++
			continue
		}
		if (age > retention.promptMs) {
			const file = recordPath(username, summary.id)
			const record = loadJsonFileIfExists(file, null)
			if (!record) { removed++; continue }
			if (stripPromptPayloads(record)) saveJsonFile(file, record)
		}
		kept.push(summary)
	}
	if (kept.length !== loadedIndex.records.length) {
		loadedIndex.records = kept
		saveIndex(username, loadedIndex)
	}
	return removed
}

/**
 * 记录一次生成。
 * @param {string} username 用户
 * @param {generationRecord_t} record 记录（缺 id 时自动生成）
 * @returns {Promise<generationRecord_t>} 落盘后的记录
 */
export async function recordGeneration(username, record) {
	if (!username) throw new Error('username is required')
	const now = Date.now()
	/** @type {generationRecord_t} */
	const full = {
		id: record.id || crypto.randomUUID(),
		parentId: record.parentId ?? null,
		charId: record.charId,
		charname: record.charname,
		subAgent: record.subAgent,
		chatId: record.chatId,
		conversationId: record.conversationId,
		source: record.source,
		startedAt: record.startedAt ?? now,
		finishedAt: record.finishedAt ?? now,
		input: record.input,
		requests: record.requests,
		requestCount: record.requestCount ?? record.requests?.length ?? 0,
		response: record.response,
		conversation: record.conversation,
		model: record.model,
		metadata: record.metadata,
		error: record.error,
	}
	return enqueue(username, async () => {
		ensureUser(username)
		saveJsonFile(recordPath(username, full.id), full)
		const index = loadIndex(username)
		index.records = index.records.filter(summary => summary.id !== full.id)
		index.records.push(toSummary(full))
		saveIndex(username, index)
		void events.emit('GenerationRecorded', { username, record: full }).catch(console.error)
		return full
	})
}

/**
 * 列出生成记录摘要（按开始时间倒序）。
 * @param {string} username 用户
 * @param {{ charId?: string, source?: string, conversationId?: string, chatId?: string, runId?: string, since?: number, limit?: number }} [filter] 过滤条件
 * @returns {Promise<object[]>} 记录摘要列表
 */
export async function listGenerations(username, filter = {}) {
	ensureUser(username)
	const index = loadIndex(username)
	pruneGenerations(username, { index })
	let records = index.records
	if (filter.charId) records = records.filter(record => record.charId === filter.charId)
	if (filter.source) records = records.filter(record => record.source === filter.source)
	if (filter.conversationId) records = records.filter(record => record.conversationId === filter.conversationId)
	if (filter.chatId) records = records.filter(record => record.chatId === filter.chatId)
	if (filter.runId) records = records.filter(record => record.subAgent?.runId === filter.runId)
	if (filter.since) records = records.filter(record => (record.startedAt || 0) >= filter.since)
	records = records.slice().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
	return records.slice(0, filter.limit ?? 100)
}

/**
 * 读取单条生成记录。
 * @param {string} username 用户
 * @param {string} id 记录 ID
 * @returns {Promise<generationRecord_t | null>} 记录或 null
 */
export async function getGeneration(username, id) {
	ensureUser(username)
	const file = recordPath(username, id)
	const record = loadJsonFileIfExists(file, null)
	if (!record) return null
	const retention = loadRetention(username)
	const action = retentionAction(record, retention, Date.now())
	if (action === 'delete') {
		try { fs.rmSync(file, { force: true }) } catch { /* 忽略删除失败 */ }
		return null
	}
	if (action === 'strip-input' && stripPromptPayloads(record)) saveJsonFile(file, record)
	return record
}

/**
 * 读取保留策略。
 * @param {string} username 用户
 * @returns {Promise<{ promptMs: number, conversationMs: number }>} 保留策略
 */
export async function getRetention(username) {
	ensureUser(username)
	return loadRetention(username)
}

/**
 * 更新保留策略。
 * @param {string} username 用户
 * @param {{ promptMs?: number, conversationMs?: number }} retention 保留策略
 * @returns {Promise<{ promptMs: number, conversationMs: number }>} 合并后的保留策略
 */
export async function setRetention(username, retention) {
	return enqueue(username, async () => {
		ensureUser(username)
		saveRetention(username, { ...loadRetention(username), ...retention })
		return loadRetention(username)
	})
}

/**
 * 列出会话摘要（按最近活动倒序）。
 * @param {string} username 用户
 * @param {{ charId?: string, source?: string, since?: number, limit?: number }} [filter] 过滤条件
 * @returns {Promise<object[]>} 会话摘要列表
 */
export async function listConversations(username, filter = {}) {
	ensureUser(username)
	const index = loadIndex(username)
	pruneGenerations(username, { index })
	let records = index.records
	if (filter.charId) records = records.filter(record => record.charId === filter.charId)
	if (filter.source) records = records.filter(record => record.source === filter.source)
	if (filter.since) records = records.filter(record => (record.startedAt || 0) >= filter.since)
	return summarizeConversations(records).slice(0, filter.limit ?? 200)
}

/**
 * 读取一个会话的全部现存生成记录（按开始时间升序）。
 * @param {string} username 用户
 * @param {string} key 会话键（`conversationKey`）
 * @returns {Promise<{ key: string, generations: object[] } | null>} 会话详情；不存在时 null
 */
export async function getConversation(username, key) {
	if (!key) return null
	ensureUser(username)
	const index = loadIndex(username)
	pruneGenerations(username, { index })
	const matching = index.records
		.filter(record => conversationKey(record) === key)
		.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
	if (!matching.length) return null
	const generations = []
	for (const summary of matching) {
		const record = await getGeneration(username, summary.id)
		if (record) generations.push(record)
	}
	if (!generations.length) return null
	return { key, generations }
}
