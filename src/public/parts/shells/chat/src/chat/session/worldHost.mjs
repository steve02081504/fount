/**
 * 【文件】worldHost.mjs — WorldChatHost：world 对 chat 存储 / p2p 层的正式调用面
 * 【职责】state（DAG world_state LWW）、localData（本机私有 JSON）、triggerCharReply、postSystemMessage、群只读摘要。
 * 【原理】state 写经 appendSignedLocalEvent；读自物化 worldStates；ChatHostConnected 惰性接线一次。
 * 【关联】append.mjs、materialize.mjs、postMessage.mjs、triggerReply.mjs、resolvePart.mjs。
 */
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { readJsonl, writeJsonAtomicSynced } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'
import { HLC } from 'npm:@steve02081504/fount-p2p/core/hlc'
import { getUserDictionary } from '../../../../../../../server/auth/index.mjs'
import { postChannelMessage } from '../channel/postMessage.mjs'
import { appendSignedLocalEvent } from '../dag/append.mjs'
import { getState } from '../dag/materialize.mjs'
import { eventsPath } from '../lib/paths.mjs'

import { triggerCharReply } from './triggerReply.mjs'

/** @type {Map<string, Promise<void>>} */
const hostConnectedOnce = new Map()

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} worldname 世界名
 * @returns {string} 缓存键
 */
function hostCacheKey(replicaUsername, groupId, worldname) {
	return `${replicaUsername}\0${groupId}\0${worldname}`
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} worldname 世界名
 * @returns {string} localData JSON 路径
 */
function localDataPath(replicaUsername, groupId, worldname) {
	return join(getUserDictionary(replicaUsername), 'worlds', worldname, 'chat_data', `${groupId}.json`)
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} worldname 世界名
 * @returns {Promise<import('../../../../../../../decl/worldAPI.ts').WorldChatHost_t>} WorldChatHost 实例
 */
export function createWorldChatHost(replicaUsername, groupId, worldname) {
	/**
	 * @param {string} key 状态键
	 * @returns {Promise<unknown>} 值；墓碑或缺失为 undefined
	 */
	async function stateGet(key) {
		const { state } = await getState(replicaUsername, groupId)
		const slot = state.worldStates?.[worldname]?.[key]
		if (!slot || slot.deleted) return undefined
		return slot.value
	}

	/**
	 * @returns {Promise<Record<string, unknown>>} 当前 LWW KV（不含墓碑）
	 */
	async function stateEntries() {
		const { state } = await getState(replicaUsername, groupId)
		const bucket = state.worldStates?.[worldname] || {}
		const out = {}
		for (const [key, slot] of Object.entries(bucket)) {
			if (slot?.deleted) continue
			out[key] = slot.value
		}
		return out
	}

	/**
	 * @param {string} key 状态键
	 * @param {unknown} value 值
	 * @returns {Promise<void>}
	 */
	async function stateSet(key, value) {
		await appendSignedLocalEvent(replicaUsername, groupId, {
			type: 'world_state',
			timestamp: Date.now(),
			content: { worldname, action: 'set', key, value },
		})
	}

	/**
	 * @param {string} key 状态键
	 * @returns {Promise<void>}
	 */
	async function stateDel(key) {
		await appendSignedLocalEvent(replicaUsername, groupId, {
			type: 'world_state',
			timestamp: Date.now(),
			content: { worldname, action: 'delete', key },
		})
	}

	/**
	 * @param {string} [sinceEventId] 起始 event id（不含）；缺省返回全部
	 * @returns {Promise<import('../../../../../../../decl/worldAPI.ts').worldStateEvent_t[]>} HLC 全序状态写入序列
	 */
	async function stateLog(sinceEventId) {
		const rows = await readJsonl(eventsPath(replicaUsername, groupId), {
			sanitize: stripDagEventLocalExtensions,
		})
		const since = sinceEventId ? String(sinceEventId).trim().toLowerCase() : ''
		let pastSince = !since
		const writes = []
		for (const row of rows) {
			if (!pastSince) {
				if (String(row.id).trim().toLowerCase() === since)
					pastSince = true
				continue
			}
			if (row.type !== 'world_state') continue
			const content = row.content || {}
			if (String(content.worldname || '').trim() !== worldname) continue
			writes.push({
				eventId: row.id,
				hlc: row.hlc,
				sender: row.sender,
				content: {
					worldname: content.worldname,
					action: content.action,
					key: content.key,
					...content.value !== undefined ? { value: content.value } : {},
				},
			})
		}
		writes.sort((a, b) => HLC.fromJSON(a.hlc).compare(HLC.fromJSON(b.hlc)))
		return writes
	}

	/**
	 * @param {string} key 本地键
	 * @returns {Promise<unknown>} 值；缺省 undefined
	 */
	async function localDataGet(key) {
		const path = localDataPath(replicaUsername, groupId, worldname)
		let store = {}
		try {
			store = JSON.parse(await readFile(path, 'utf8'))
		}
		catch {
			return undefined
		}
		return store[key]
	}

	/**
	 * @param {string} key 本地键
	 * @param {unknown} value 值
	 * @returns {Promise<void>}
	 */
	async function localDataSet(key, value) {
		const path = localDataPath(replicaUsername, groupId, worldname)
		await mkdir(dirname(path), { recursive: true })
		let store = {}
		try {
			store = JSON.parse(await readFile(path, 'utf8'))
		}
		catch { /* 新文件 */ }
		store[key] = value
		await writeJsonAtomicSynced(path, store)
	}

	/**
	 * @returns {Promise<import('../../../../../../../decl/worldAPI.ts').memberSummary_t[]>} 活跃成员摘要
	 */
	async function listMembers() {
		const { state } = await getState(replicaUsername, groupId)
		return Object.entries(state.members || {})
			.filter(([, member]) => member?.status === 'active')
			.map(([memberKey, member]) => ({
				memberKey,
				memberKind: member.memberKind || 'user',
				charname: member.charname,
				ownerUsername: member.ownerUsername,
				homeNodeHash: member.homeNodeHash,
				roles: member.roles,
			}))
	}

	/**
	 * @returns {Promise<import('../../../../../../../decl/worldAPI.ts').channelSummary_t[]>} 频道摘要
	 */
	async function listChannels() {
		const { state } = await getState(replicaUsername, groupId)
		return Object.entries(state.channels || {}).map(([channelId, channel]) => ({
			channelId,
			name: channel?.name,
			type: channel?.type,
		}))
	}

	return {
		groupId,
		replicaUsername,
		worldname,
		state: {
			get: stateGet,
			entries: stateEntries,
			set: stateSet,
			del: stateDel,
			log: stateLog,
		},
		localData: {
			get: localDataGet,
			set: localDataSet,
		},
		/**
		 * @param {string} channelId 频道 ID
		 * @param {string} charname 角色名
		 * @returns {Promise<void>}
		 */
		async triggerCharReply(channelId, charname) {
			await triggerCharReply(groupId, channelId, charname, null, { replicaUsername })
		},
		/**
		 * @param {string} channelId 频道 ID
		 * @param {import('../../../../../../../decl/chatLog.ts').channelMessageContent_t} content 消息内容
		 * @returns {Promise<void>}
		 */
		async postSystemMessage(channelId, content) {
			await postChannelMessage(replicaUsername, groupId, channelId, { rawContent: content })
		},
		listMembers,
		listChannels,
	}
}

/**
 * 本机 world part 首次 resolve 时调用 ChatHostConnected（进程内 once）。
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} worldname 世界名
 * @param {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t} world 已加载的 world API
 * @returns {Promise<void>}
 */
export async function ensureWorldHostConnected(replicaUsername, groupId, worldname, world) {
	const hook = world?.interfaces?.chat?.ChatHostConnected
	if (!hook) return
	const key = hostCacheKey(replicaUsername, groupId, worldname)
	if (hostConnectedOnce.has(key))
		return hostConnectedOnce.get(key)
	const task = (async () => {
		const host = createWorldChatHost(replicaUsername, groupId, worldname)
		await hook(host)
	})()
	hostConnectedOnce.set(key, task)
	return task
}

/**
 * 测试用：清空 ChatHostConnected once 缓存。
 * @returns {void}
 */
export function resetWorldHostConnectedCacheForTests() {
	hostConnectedOnce.clear()
}
