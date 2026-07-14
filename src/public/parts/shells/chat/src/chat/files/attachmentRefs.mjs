/**
 * 【文件】files/attachmentRefs.mjs
 * 【职责】从 DAG、context sidecar 与内存 chatLog 收集仍被引用的 EVFS 路径（GC 根）。
 * 【原理】collectEvfsRefsFromValue 递归 JSON；遍历 events/quarantine/messages 与 runtime chatLog。
 * 【数据结构】Set<string> entityHash/logicalPath。
 * 【关联】blobStore、contextSidecar、session/wsLifecycle groupMetadatas；groupFiles、channel/postMessage。
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'
import { parseEvfsRef } from 'npm:@steve02081504/fount-p2p/files/evfs_ref'

import { loadJsonFile } from '../../../../../../../scripts/json_loader.mjs'
import { isEnoent, rethrowUnlessEnoentOrEnotdir } from '../lib/fsSafe.mjs'
import { groupDir, eventsPath, quarantinePath } from '../lib/paths.mjs'
import { listUserGroups } from '../lib/userGroups.mjs'
import { groupMetadatas } from '../session/wsLifecycle.mjs'

/**
 * @param {unknown} value JSON 子树
 * @param {Set<string>} evfsPaths EVFS 逻辑路径 entityHash/logicalPath
 * @returns {void}
 */
export function collectEvfsRefsFromValue(value, evfsPaths) {
	if (typeof value === 'string') {
		const parsed = parseEvfsRef(value)
		if (parsed) evfsPaths.add(`${parsed.entityHash}/${parsed.logicalPath}`)
		return
	}
	if (!value || typeof value !== 'object') return
	if (Array.isArray(value)) {
		for (const item of value) collectEvfsRefsFromValue(item, evfsPaths)
		return
	}
	for (const key of Object.keys(value))
		collectEvfsRefsFromValue(value[key], evfsPaths)
}

/**
 * @param {object} entry 聊天日志条目或侧车上下文行
 * @param {Set<string>} evfsPaths EVFS 路径
 * @returns {void}
 */
function collectFromChatLogEntry(entry, evfsPaths) {
	if (!entry) return
	for (const file of entry.files || []) {
		const buffer = file?.buffer
		if (typeof buffer === 'string') {
			const parsed = parseEvfsRef(buffer)
			if (parsed) evfsPaths.add(`${parsed.entityHash}/${parsed.logicalPath}`)
		}
	}
	for (const contextEntry of entry.logContextBefore || [])
		collectFromChatLogEntry(contextEntry, evfsPaths)
	for (const contextEntry of entry.logContextAfter || [])
		collectFromChatLogEntry(contextEntry, evfsPaths)
}

/**
 * @param {string} username replica 所有者
 * @param {Set<string>} evfsPaths EVFS 路径
 * @returns {void}
 */
function collectFromRuntimeChatMetadatas(username, evfsPaths) {
	for (const [, slot] of groupMetadatas) {
		if (slot.username !== username || !slot.chatMetadata) continue
		for (const entry of slot.chatMetadata.chatLog)
			collectFromChatLogEntry(entry, evfsPaths)
	}
}

/**
 * @param {object[]} lines JSONL 行
 * @param {Set<string>} evfsPaths EVFS 路径
 * @returns {void}
 */
function collectFromDagJsonlLines(lines, evfsPaths) {
	const deleted = new Set()
	for (const line of lines)
		if (line.type === 'message_delete' && line.content?.targetId)
			deleted.add(String(line.content.targetId))

	for (const line of lines) {
		if (line.type === 'message') {
			const messageId = line.eventId
			if (messageId && deleted.has(String(messageId))) continue
		}
		else if (line.type === 'message_edit') {
			const targetId = line.content?.targetId
			if (targetId && deleted.has(String(targetId))) continue
		}
		else if (line.type === 'message_delete')
			continue

		collectEvfsRefsFromValue(line, evfsPaths)
	}
}

/**
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @param {Set<string>} evfsPaths EVFS 路径
 * @returns {Promise<void>}
 */
async function scanGroupContextCache(username, groupId, evfsPaths) {
	const contextCacheRoot = join(groupDir(username, groupId), 'context_cache')
	let channelDirNames = []
	try {
		channelDirNames = await readdir(contextCacheRoot)
	}
	catch (error) {
		if (isEnoent(error)) return
		throw error
	}

	for (const channelDirName of channelDirNames) {
		const channelPath = join(contextCacheRoot, channelDirName)
		let sidecarNames = []
		try {
			sidecarNames = await readdir(channelPath)
		}
		catch (error) {
			if (isEnoent(error)) continue
			throw error
		}
		for (const name of sidecarNames) {
			if (!name.endsWith('.json')) continue
			collectEvfsRefsFromValue(loadJsonFile(join(channelPath, name)), evfsPaths)
		}
	}
}

/**
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @param {Set<string>} evfsPaths EVFS 路径 entityHash/logicalPath
 * @returns {Promise<void>}
 */
async function scanGroupDagStores(username, groupId, evfsPaths) {
	const messagesDir = join(groupDir(username, groupId), 'messages')
	let indexFilenames = []
	try {
		indexFilenames = await readdir(messagesDir)
	}
	catch (error) {
		rethrowUnlessEnoentOrEnotdir(error)
	}
	for (const name of indexFilenames) {
		if (!name.endsWith('.jsonl')) continue
		const lines = await readJsonl(join(messagesDir, name), { sanitize: stripDagEventLocalExtensions })
		collectFromDagJsonlLines(lines, evfsPaths)
	}

	collectFromDagJsonlLines(
		await readJsonl(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions }),
		evfsPaths,
	)
	collectFromDagJsonlLines(
		await readJsonl(quarantinePath(username, groupId), { sanitize: stripDagEventLocalExtensions }),
		evfsPaths,
	)
	await scanGroupContextCache(username, groupId, evfsPaths)
}

/**
 * 汇总仍被引用的 EVFS 路径（entityHash/logicalPath）。
 * @param {string} username 本地账户名
 * @returns {Promise<Set<string>>} entityHash/logicalPath 集合
 */
export async function collectReferencedEvfsPaths(username) {
	const evfsPaths = new Set()
	collectFromRuntimeChatMetadatas(username, evfsPaths)
	for (const groupId of await listUserGroups(username))
		await scanGroupDagStores(username, groupId, evfsPaths)
	return evfsPaths
}
