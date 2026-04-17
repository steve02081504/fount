/**
 * 角色回复的 logContextBefore / logContextAfter 本地 sidecar（不上 DAG / 不入主 chat JSON）。
 * 路径：{userDict}/shells/chat/groups/{groupId}/context_cache/{channelId}/{messageId}.json
 *
 * ─── Sidecar 可达性根（mark–sweep GC；无单独 ledger 文件，每次从根重新推导）────────
 * 1. 会话元数据 `chats/{groupId}.json`：`chatLog`（旧版全量）与 `chatLogPrelude` 中的条目 id +
 *    频道 `extension.groupChannelId`（缺省为 `default`）。DAG 迁移后磁盘上 `chatLog` 常为空，
 *    故须与下列根取并集。
 * 2. 物化消息索引 `groups/{groupId}/messages/{channelId}.jsonl`：按行解析，先收集
 *    `message_delete` 的 `content.chatLogEntryId`，再对 `type === 'message'` 的行保留
 *    `content.chatLogEntryId`（或 `eventId`）且未被 delete 集合标记的 id。
 * 3. DAG 事件流 `groups/{groupId}/events.jsonl`：同上规则；频道取事件的 `channelId` 或
 *    `content.channelId`，缺省 `default`。checkpoint.json 仅锚定重放位置，不枚举侧车键；
 *    与索引一致时与 (2) 重叠，并集可避免 messages 与 events 短暂不一致时的误删。
 * 4. 可选调用方传入的内存 `chatLog`（与磁盘并集），避免仅内存有正文而 JSON 尚未写回时误删。
 *
 * 周期：任意时刻可调用 `gcLogContextSidecars`；`deleteMessage`、DAG 裁剪后、会话 reconcile 等路径会触发。
 */
import fs from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { loadJsonFile, saveJsonFile } from '../../../../../../scripts/json_loader.mjs'

import { readJsonl } from './dag_storage.mjs'
import { chatDir, chatJsonPath, eventsPath, sidecarPath } from './paths.mjs'
import {
	isEnoent,
	rethrowUnlessEnoentOrEnotdir,
	rethrowUnlessMissingOrInvalidJson,
	safeUnlink,
	safeUnlinkSync,
} from './utils.mjs'

/**
 * @param {{ extension?: { groupChannelId?: string } }} entry 聊天条目（含 extension 频道）
 * @returns {string} 用于侧车目录名的频道 id
 */
function sidecarChannelForEntry(entry) {
	const g = entry?.extension?.groupChannelId
	if (typeof g === 'string' && /^[\w.-]+$/u.test(g) && g.length <= 128) return g
	return 'default'
}

/**
 * @param {Map<string, Set<string>>} reachable 频道 → 消息 id 可达集
 * @param {string} channelId 频道 id
 * @param {string} messageId 消息条目 id
 * @returns {void}
 */
function addReachable(reachable, channelId, messageId) {
	const ch = String(channelId)
	const id = String(messageId)
	if (!reachable.has(ch)) reachable.set(ch, new Set())
	reachable.get(ch).add(id)
}

/**
 * @param {{ id?: string, extension?: object } | undefined} entry 聊天条目
 * @param {Map<string, Set<string>>} reachable 频道 → 消息 id 可达集
 * @returns {void}
 */
function addReachableFromChatEntry(entry, reachable) {
	if (!entry?.id) return
	addReachable(reachable, sidecarChannelForEntry(entry), String(entry.id))
}

/**
 * 与 `hydrateChatLogFromDag` / 物化 JSONL 一致：先 delete 集，再保留仍存在的 message 行。
 * @param {object[]} lines 某频道 JSONL 解析后的行对象数组
 * @param {string} channelId 该 JSONL 对应的频道 id（文件名）
 * @param {Map<string, Set<string>>} reachable 频道 → 消息 id 可达集（就地写入）
 * @returns {void}
 */
function mergeReachableFromMessageIndexLines(lines, channelId, reachable) {
	const deleted = new Set()
	for (const line of lines) 
		if (line.type === 'message_delete' && line.content?.chatLogEntryId)
			deleted.add(String(line.content.chatLogEntryId))
	
	for (const line of lines) {
		if (line.type !== 'message') continue
		const cid = line.content?.chatLogEntryId || line.eventId
		if (!cid) continue
		const sid = String(cid)
		if (deleted.has(sid)) continue
		addReachable(reachable, channelId, sid)
	}
}

/**
 * 从磁盘上的元数据、messages 索引与 events 流合并推导可达消息 id。
 * @param {string} username 本地账户名
 * @param {string} groupId 群 / 会话 id
 * @returns {Promise<Map<string, Set<string>>>} 频道 id → 该频道仍被引用的 messageId 集合
 */
async function collectReachableSidecarRefsFromDisk(username, groupId) {
	/** @type {Map<string, Set<string>>} */
	const reachable = new Map()

	const metaPath = chatJsonPath(username, groupId)
	if (fs.existsSync(metaPath)) {
		const data = loadJsonFile(metaPath)
		for (const entry of Array.isArray(data.chatLog) ? data.chatLog : [])
			addReachableFromChatEntry(entry, reachable)
		for (const entry of Array.isArray(data.chatLogPrelude) ? data.chatLogPrelude : [])
			addReachableFromChatEntry(entry, reachable)
	}

	const msgDir = join(chatDir(username, groupId), 'messages')
	let msgNames = []
	try {
		msgNames = await readdir(msgDir)
	}
	catch (e) {
		rethrowUnlessEnoentOrEnotdir(e)
	}
	for (const name of msgNames) {
		if (!name.endsWith('.jsonl')) continue
		const channelId = name.slice(0, -6)
		const lines = await readJsonl(join(msgDir, name))
		mergeReachableFromMessageIndexLines(lines, channelId, reachable)
	}

	const ep = eventsPath(username, groupId)
	const eventLines = await readJsonl(ep)
	const deleted = new Set()
	for (const line of eventLines) 
		if (line.type === 'message_delete' && line.content?.chatLogEntryId)
			deleted.add(String(line.content.chatLogEntryId))
	
	for (const line of eventLines) {
		if (line.type !== 'message') continue
		const cid = line.content?.chatLogEntryId || line.eventId
		if (!cid) continue
		const sid = String(cid)
		if (deleted.has(sid)) continue
		const ch = typeof line.channelId === 'string' && /^[\w.-]+$/u.test(line.channelId) && line.channelId.length <= 128
			? line.channelId
			: typeof line.content?.channelId === 'string' && /^[\w.-]+$/u.test(line.content.channelId) && line.content.channelId.length <= 128
				? line.content.channelId
				: 'default'
		addReachable(reachable, ch, sid)
	}

	return reachable
}

/**
 * 删除 `context_cache` 下不可达侧车文件（由 `collectReachableSidecarRefsFromDisk` + 可选内存 chatLog 推导可达集）。
 * @param {string} username 本地账户名
 * @param {string} groupId 群 / 会话 id
 * @param {Map<string, Set<string>>} reachable 频道 → 应保留的消息 id 集合
 * @returns {Promise<void>}
 */
async function deleteUnreachableSidecars(username, groupId, reachable) {
	const ctxRoot = join(chatDir(username, groupId), 'context_cache')
	let chNames = []
	try {
		chNames = await readdir(ctxRoot)
	}
	catch (e) {
		if (isEnoent(e)) return
		throw e
	}
	for (const ch of chNames) {
		const chPath = join(ctxRoot, ch)
		let st
		try {
			st = await stat(chPath)
		}
		catch (e) {
			if (isEnoent(e)) continue
			throw e
		}
		if (!st.isDirectory()) continue
		const keep = reachable.get(ch) ?? new Set()
		let files = []
		try {
			files = await readdir(chPath)
		}
		catch (e) {
			if (isEnoent(e)) continue
			throw e
		}
		for (const name of files) {
			if (!name.endsWith('.json')) continue
			const id = name.slice(0, -5)
			if (keep.has(id)) continue
			const p = join(chPath, name)
			try {
				await safeUnlink(p)
			}
			catch (e) {
				console.error('deleteUnreachableSidecars: unlink failed', p, e)
				throw e
			}
		}
	}
}

/**
 * 从根做 mark–sweep，删除不可达的 logContext sidecar。
 * @param {string} username 本地账户名
 * @param {string} groupId 群 / 会话 id
 * @param {{ chatLog?: Array<{ id?: string, extension?: object }> }} [opts] 与磁盘元数据并集（例如内存中已 hydrate 的 chatLog）
 * @returns {Promise<void>}
 */
export async function gcLogContextSidecars(username, groupId, opts = {}) {
	const reachable = await collectReachableSidecarRefsFromDisk(username, groupId)
	if (Array.isArray(opts.chatLog))
		for (const entry of opts.chatLog)
			addReachableFromChatEntry(entry, reachable)

	await deleteUnreachableSidecars(username, groupId, reachable)
}

/**
 * 若条目含 before/after 上下文则写入 sidecar 并清空内存中的数组（避免落盘到主 JSON）。
 * @param {string} username 本地账户名
 * @param {string} groupId 会话 / 群 ID
 * @param {string} channelId 频道 ID
 * @param {{ logContextBefore?: unknown[], logContextAfter?: unknown[], id: string }} entry 聊天日志条目
 * @returns {Promise<void>}
 */
export async function persistLogContextSidecar(username, groupId, channelId, entry) {
	const before = entry.logContextBefore
	const after = entry.logContextAfter
	if ((!before || !before.length) && (!after || !after.length)) return
	const p = sidecarPath(username, groupId, channelId, entry.id)
	await mkdir(dirname(p), { recursive: true })
	saveJsonFile(p, { before: before || [], after: after || [] })
	entry.logContextBefore = []
	entry.logContextAfter = []
}

/**
 * 从 sidecar 合并 before/after 到条目（仅内存，不写回 JSON）。
 * @param {string} username 本地账户名
 * @param {string} groupId 会话 / 群 ID
 * @param {string} channelId 频道 ID
 * @param {{ id: string, logContextBefore?: unknown[], logContextAfter?: unknown[], extension?: object }} entry 聊天日志条目
 * @returns {Promise<void>}
 */
export async function hydrateLogContextFromSidecar(username, groupId, channelId, entry) {
	if (!entry?.id) return
	const p = sidecarPath(username, groupId, channelId, entry.id)
	if (!fs.existsSync(p)) return
	try {
		const data = loadJsonFile(p)
		if (Array.isArray(data.before) && data.before.length)
			entry.logContextBefore = data.before
		if (Array.isArray(data.after) && data.after.length)
			entry.logContextAfter = data.after
	}
	catch (e) {
		rethrowUnlessMissingOrInvalidJson(e)
	}
}

/**
 * 删除某条消息对应的 sidecar 文件（显式删除；ENOENT 视为已不存在）。
 * @param {string} username 本地账户名
 * @param {string} groupId 会话 / 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} messageId 消息条目 ID
 * @returns {void}
 */
export function deleteLogContextSidecar(username, groupId, channelId, messageId) {
	safeUnlinkSync(sidecarPath(username, groupId, channelId, messageId))
}
