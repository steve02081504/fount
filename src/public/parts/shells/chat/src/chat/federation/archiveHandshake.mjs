/**
 * 【文件】federation/archiveHandshake.mjs
 * 【职责】gossip/wantIds 前的存档摘要握手：判断对端 archiveSummary 与本机 DAG 是否可对齐，并加载本地 events+checkpoint 生成应答用摘要。
 * 【原理】evaluateArchiveHandshake 比较摘要 tipsHash、hash、lastEventId 与 wantIds 命中；严格对齐时全 unknown want 可记信誉惩罚。wireArchiveSummary 将 computeArchiveSummary 结果序列化为联邦 gossip 载荷。
 * 【数据结构】archiveSummary { hash, eventCount, lastEventId, checkpointEventId, tips, tipsHash }；loadLocalFederationArchive 返回 events、checkpoint、summary。
 * 【关联】gossip.mjs、room.mjs tip ping、gossip 转发；npm:@steve02081504/fount-p2p/archive_summary.mjs、lib/paths eventsPath/snapshotPath。
 */
import { readFile } from 'node:fs/promises'

import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { loadPeerPoolView } from 'npm:@steve02081504/fount-p2p/node/network'
import { isPlainObject } from 'npm:@steve02081504/fount-p2p/wire/ingress'
import { computeArchiveSummary } from '../archive/summary.mjs'
import { eventsPath, snapshotPath } from '../lib/paths.mjs'

/**
 * §9 存档握手：严格对齐、可合并前缀、或本批 want 中至少一条本地可应答。
 * @param {unknown} remoteSummary 对端 `archiveSummary`
 * @param {{ hash: string, eventCount: number, lastEventId: string, checkpointEventId: string, tipsHash?: string }} localSummary 本机摘要
 * @param {object[]} localEvents 本机 DAG 行
 * @param {string[]} wantIds 本批请求的 id
 * @returns {{ allow: boolean, strictAligned: boolean }} 是否处理 want 与是否严格对齐
 */
export function evaluateArchiveHandshake(remoteSummary, localSummary, localEvents, wantIds) {
	if (localSummary.eventCount === 0)
		return { allow: true, strictAligned: false }
	if (!isPlainObject(remoteSummary))
		return { allow: false, strictAligned: false }
	const remote = remoteSummary
	const remoteHash = String(remote.hash || '').trim().toLowerCase()
	if (!isHex64(remoteHash)) return { allow: false, strictAligned: false }
	const remoteEventCount = Number(remote.eventCount)
	if (!Number.isFinite(remoteEventCount) || remoteEventCount < 0) return { allow: false, strictAligned: false }

	const remoteTipsHash = String(remote.tipsHash || '').trim().toLowerCase()
	const localTipsHash = String(localSummary.tipsHash || '').trim().toLowerCase()
	if (isHex64(remoteTipsHash) && remoteTipsHash === localTipsHash)
		return { allow: true, strictAligned: true }

	if (remoteEventCount === 0) return { allow: true, strictAligned: false }

	const eventsById = new Map(localEvents.map(event => [event.id, event]))
	const anyWantHit = wantIds.some(id => eventsById.has(id))

	const localHash = String(localSummary.hash || '').trim().toLowerCase()
	if (isHex64(remoteHash) && remoteHash === localHash)
		return { allow: true, strictAligned: true }

	const remoteLastEventId = String(remote.lastEventId || '').trim().toLowerCase()
	const localLastEventId = isHex64(localSummary.lastEventId)
		? String(localSummary.lastEventId).trim().toLowerCase()
		: ''
	if (isHex64(remoteLastEventId) && eventsById.has(remoteLastEventId))
		return { allow: true, strictAligned: false }
	if (remoteLastEventId && localLastEventId && remoteLastEventId === localLastEventId)
		return { allow: true, strictAligned: false }
	if (anyWantHit)
		return { allow: true, strictAligned: false }
	return { allow: false, strictAligned: false }
}

/**
 * @param {{ hash: string, eventCount: number, lastEventId: string, checkpointEventId: string, tips?: string, tipsHash?: string }} summary 本机 `computeArchiveSummary` 结果
 * @returns {{ hash: string, eventCount: number, lastEventId: string, checkpointEventId: string, tips: string, tipsHash: string }} 联邦 gossip 载荷字段
 */
export function wireArchiveSummary(summary) {
	return {
		hash: summary.hash,
		eventCount: summary.eventCount,
		lastEventId: summary.lastEventId || '',
		checkpointEventId: summary.checkpointEventId || '',
		tips: summary.tips || '',
		tipsHash: summary.tipsHash || '',
	}
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {(path: string) => Promise<object[]>} readJsonl DAG 读行
 * @returns {Promise<{ events: object[], checkpoint: object | null, summary: object }>} 本地事件、检查点与存档摘要
 */
export async function loadLocalFederationArchive(username, groupId, readJsonl) {
	let events = []
	try {
		events = await readJsonl(eventsPath(username, groupId))
	}
	catch {
		// 组被清理后联邦房间可能还有迟到帧；缺失 events 文件时降级为空，避免打崩 Node 进程。
		events = []
	}
	let checkpoint = null
	try {
		checkpoint = JSON.parse(await readFile(snapshotPath(username, groupId), 'utf8'))
	}
	catch { /* absent */ }
	let deniedSubjects = []
	try {
		const peers = loadPeerPoolView( groupId)
		deniedSubjects = peers.deniedSubjects || []
	}
	catch { /* absent */ }
	return {
		events,
		checkpoint,
		summary: computeArchiveSummary(events, checkpoint, { deniedSubjects }),
	}
}
