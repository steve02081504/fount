/**
 * 【文件】lib/contextSidecar.mjs — 角色回复 logContext 本地 sidecar（不上 DAG）。
 * 可达性 mark-sweep：messages.jsonl + events.jsonl + 可选内存 chatLog。
 */
import fs from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'

import { loadJsonFile, saveJsonFile } from '../../../../../../../scripts/json_loader.mjs'

import { isChannelIdValid, resolveChannelId } from './channelId.mjs'
import {
	isEnoent,
	rethrowUnlessEnoentOrEnotdir,
	safeUnlink,
	safeUnlinkSync,
} from './fsSafe.mjs'
import { groupDir, eventsPath, sidecarPath } from './paths.mjs'

/**
 * @param {{ extension?: { groupChannelId?: string } }} entry 聊天条目（含 extension 频道）
 * @param {string} scopeChannelId 已解析的会话频道 id（调用方保证合法）
 * @returns {string} 用于侧车目录名的频道 id
 */
export function sidecarChannelForEntry(entry, scopeChannelId) {
	return isChannelIdValid(entry?.extension?.groupChannelId)
		? String(entry.extension.groupChannelId).trim()
		: scopeChannelId
}

/**
 * @param {Map<string, Set<string>>} reachable 频道 → 消息 id 可达集
 * @param {string} channelId 频道 id
 * @param {string} messageId 消息条目 id
 * @returns {void}
 */
function addReachable(reachable, channelId, messageId) {
	const channelKey = String(channelId)
	const id = String(messageId)
	if (!reachable.has(channelKey)) reachable.set(channelKey, new Set())
	reachable.get(channelKey).add(id)
}

/**
 * @param {{ id?: string, extension?: object } | undefined} entry 聊天条目
 * @param {Map<string, Set<string>>} reachable 频道 → 消息 id 可达集
 * @returns {void}
 */
function addReachableFromChatEntry(entry, reachable) {
	if (entry?.id)
		addReachable(reachable, resolveChannelId(entry?.extension?.groupChannelId), String(entry.id))
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
		if (line.type === 'message_delete' && line.content?.targetId)
			deleted.add(String(line.content.targetId))

	for (const line of lines) {
		if (line.type !== 'message') continue
		const messageId = line.eventId
		if (!messageId) continue
		const sid = String(messageId)
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

	const messagesDir = join(groupDir(username, groupId), 'messages')
	let messageIndexFilenames = []
	try {
		messageIndexFilenames = await readdir(messagesDir)
	}
	catch (e) {
		rethrowUnlessEnoentOrEnotdir(e)
	}
	for (const name of messageIndexFilenames) {
		if (!name.endsWith('.jsonl')) continue
		const channelId = name.slice(0, -6)
		const lines = await readJsonl(join(messagesDir, name), { sanitize: stripDagEventLocalExtensions })
		mergeReachableFromMessageIndexLines(lines, channelId, reachable)
	}

	const ep = eventsPath(username, groupId)
	const eventLines = await readJsonl(ep, { sanitize: stripDagEventLocalExtensions })
	const deleted = new Set()
	for (const line of eventLines)
		if (line.type === 'message_delete' && line.content?.targetId)
			deleted.add(String(line.content.targetId))

	for (const line of eventLines) {
		if (line.type !== 'message') continue
		const messageId = line.id
		if (!messageId) continue
		const sid = String(messageId)
		if (deleted.has(sid)) continue
		addReachable(reachable, resolveChannelId(line.channelId), sid)
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
	const contextCacheRoot = join(groupDir(username, groupId), 'context_cache')
	let channelDirNames = []
	try {
		channelDirNames = await readdir(contextCacheRoot)
	}
	catch (e) {
		if (isEnoent(e)) return
		throw e
	}
	for (const channelDirName of channelDirNames) {
		const chPath = join(contextCacheRoot, channelDirName)
		let st
		try {
			st = await stat(chPath)
		}
		catch (e) {
			if (isEnoent(e)) continue
			throw e
		}
		if (!st.isDirectory()) continue
		const keep = reachable.get(channelDirName) ?? new Set()
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
	if (!entry.id) return
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
	if (!entry.id) return
	const sidecarFilePath = sidecarPath(username, groupId, channelId, entry.id)
	if (!fs.existsSync(sidecarFilePath)) return
	const data = loadJsonFile(sidecarFilePath)
	if (data.before?.length)
		entry.logContextBefore = data.before
	if (data.after?.length)
		entry.logContextAfter = data.after
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
