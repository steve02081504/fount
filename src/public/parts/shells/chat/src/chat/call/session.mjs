/**
 * 【文件】call/session.mjs
 * 【职责】群组通话生命周期：首人入房发 call 卡片，roster 变化编辑参与者，空房定稿；崩溃收尾。
 * 【原理】av-relay call room 钩子驱动；消息以发起者 entityHash 签名；active.json 持久化通话锚点。
 * 【关联】ws/avRelay、channel/postMessage、dag/append、paths activeCallsPath。
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { dirname } from 'node:path'

import { loadJsonFileIfExists, saveJsonFile } from '../../../../../../../scripts/json_loader.mjs'
import { postChannelMessage } from '../channel/postMessage.mjs'
import { appendSignedLocalEvent } from '../dag/append.mjs'
import { activeCallsPath } from '../lib/paths.mjs'

/** @type {Map<string, object>} roomKey → 进程内通话态 */
const liveCalls = new Map()

/**
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {string} av-relay roomId
 */
export function callRoomId(groupId, channelId) {
	return `${groupId}:${channelId}:call`
}

/**
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {string} 进程内 key
 */
function callKey(groupId, channelId) {
	return `${groupId}:${channelId}`
}

/**
 * @param {string} username replica
 * @returns {object} active.json 对象
 */
function loadActiveCalls(username) {
	return loadJsonFileIfExists(activeCallsPath(username), { calls: {} })
}

/**
 * @param {string} username replica
 * @param {object} data 全量快照
 * @returns {void}
 */
function saveActiveCalls(username, data) {
	const path = activeCallsPath(username)
	fs.mkdirSync(dirname(path), { recursive: true })
	saveJsonFile(path, data)
}

/**
 * @param {string[]} participants 参与者
 * @returns {string[]} 去重小写
 */
function uniqHashes(participants) {
	return [...new Set(participants.map(h => String(h || '').toLowerCase()).filter(Boolean))]
}

/**
 * @param {object} session 通话态
 * @returns {object} call 卡片 content
 */
function buildCallContent(session) {
	const participants = uniqHashes(session.everJoined || [])
	const content = {
		type: 'call',
		callId: session.callId,
		status: session.status,
		startedAt: session.startedAt,
		initiator: session.initiator,
		participants,
		current: uniqHashes(session.current || []),
	}
	if (session.status === 'ended') {
		content.endedAt = session.endedAt
		content.duration = Math.max(0, (session.endedAt || Date.now()) - session.startedAt)
	}
	return content
}

/**
 * @param {object} session 通话态
 * @returns {Promise<void>}
 */
async function persistCallCard(session) {
	const content = buildCallContent(session)
	if (!session.messageEventId) {
		const { event } = await postChannelMessage(session.username, session.groupId, session.channelId, {
			rawContent: content,
			origin: 'system',
			entityHash: session.initiator,
		})
		session.messageEventId = event.id
		writeActiveEntry(session)
		return
	}
	await appendSignedLocalEvent(session.username, session.groupId, {
		type: 'message_edit',
		channelId: session.channelId,
		timestamp: Date.now(),
		content: {
			targetId: session.messageEventId,
			newContent: content,
		},
	}, { entityHash: session.initiator })
	writeActiveEntry(session)
}

/**
 * @param {object} session 通话态
 * @returns {void}
 */
function writeActiveEntry(session) {
	const data = loadActiveCalls(session.username)
	if (session.status === 'ended') 
		delete data.calls[session.callId]
	
	else 
		data.calls[session.callId] = {
			callId: session.callId,
			username: session.username,
			groupId: session.groupId,
			channelId: session.channelId,
			initiator: session.initiator,
			messageEventId: session.messageEventId,
			startedAt: session.startedAt,
			everJoined: uniqHashes(session.everJoined || []),
			status: 'ongoing',
		}
	
	saveActiveCalls(session.username, data)
}

/**
 * 首个带 entityHash 的对等端入房：发起通话卡片。
 * @param {string} username replica
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @param {string} initiatorEntityHash 发起者
 * @returns {Promise<object>} session
 */
export async function beginCallSession(username, groupId, channelId, initiatorEntityHash) {
	const key = callKey(groupId, channelId)
	if (liveCalls.has(key)) return liveCalls.get(key)
	const { getAvRelayRoster } = await import('../ws/avRelay.mjs')
	const initiator = String(initiatorEntityHash || '').toLowerCase()
	const rosterHashes = getAvRelayRoster(callRoomId(groupId, channelId)).map(p => p.entityHash)
	const initial = uniqHashes([initiator, ...rosterHashes])
	const session = {
		callId: randomUUID(),
		username,
		groupId,
		channelId,
		initiator,
		startedAt: Date.now(),
		status: 'ongoing',
		everJoined: initial,
		current: initial,
		messageEventId: null,
	}
	liveCalls.set(key, session)
	await persistCallCard(session)
	return session
}

/**
 * roster 变更：更新参与者并编辑卡片。
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @param {{ entityHash: string, senderId: string }[]} roster 当前 roster
 * @returns {Promise<object | null>} session
 */
export async function updateCallRoster(groupId, channelId, roster) {
	const key = callKey(groupId, channelId)
	const session = liveCalls.get(key)
	if (!session || session.status !== 'ongoing') return null
	const current = uniqHashes(roster.map(p => p.entityHash))
	session.current = current
	session.everJoined = uniqHashes([...session.everJoined || [], ...current])
	await persistCallCard(session)
	return session
}

/**
 * 房间清空：定稿 ended。
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {Promise<object | null>} session
 */
export async function endCallSession(groupId, channelId) {
	const key = callKey(groupId, channelId)
	const session = liveCalls.get(key)
	if (!session || session.status !== 'ongoing') {
		liveCalls.delete(key)
		return null
	}
	session.status = 'ended'
	session.endedAt = Date.now()
	session.current = []
	await persistCallCard(session)
	liveCalls.delete(key)
	return session
}

/**
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {object | null} 进程内通话态
 */
export function getLiveCallSession(groupId, channelId) {
	return liveCalls.get(callKey(groupId, channelId)) || null
}

/**
 * HTTP 轻量状态。
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {{ active: boolean, peerCount: number, callId?: string, participants?: string[] }} 状态
 */
export function getCallStatus(groupId, channelId) {
	const session = getLiveCallSession(groupId, channelId)
	if (!session || session.status !== 'ongoing')
		return { active: false, peerCount: 0 }
	return {
		active: true,
		peerCount: (session.current || []).length,
		callId: session.callId,
		participants: [...session.current || []],
	}
}

/**
 * shell Load 时扫描悬挂通话并定稿。
 * @param {string} username replica
 * @returns {Promise<number>} 收尾条数
 */
export async function reconcileOrphanedCalls(username) {
	const data = loadActiveCalls(username)
	const calls = Object.values(data.calls || {})
	let n = 0
	for (const row of calls) {
		if (!row?.messageEventId || !row.initiator) continue
		const key = callKey(row.groupId, row.channelId)
		if (liveCalls.has(key)) continue
		try {
			const endedAt = Date.now()
			await appendSignedLocalEvent(username, row.groupId, {
				type: 'message_edit',
				channelId: row.channelId,
				timestamp: endedAt,
				content: {
					targetId: row.messageEventId,
					newContent: {
						type: 'call',
						callId: row.callId,
						status: 'ended',
						startedAt: row.startedAt,
						endedAt,
						duration: Math.max(0, endedAt - (row.startedAt || endedAt)),
						initiator: row.initiator,
						participants: uniqHashes(row.everJoined || []),
						current: [],
					},
				},
			}, { entityHash: row.initiator })
			delete data.calls[row.callId]
			n++
		}
		catch (error) {
			console.error('call: reconcile orphan failed', row.callId, error)
		}
	}
	if (n) saveActiveCalls(username, data)
	return n
}

/**
 * 为所有已知用户扫悬挂通话（Load 时）。
 * @returns {Promise<void>}
 */
export async function reconcileAllOrphanedCalls() {
	const { getAllUserNames } = await import('../../../../../../../server/auth/index.mjs')
	const names = typeof getAllUserNames === 'function' ? getAllUserNames() : []
	for (const username of names)
		await reconcileOrphanedCalls(username).catch(error => console.error('call: reconcile', username, error))
}
