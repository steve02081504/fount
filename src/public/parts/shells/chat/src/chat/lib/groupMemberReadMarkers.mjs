/**
 * 【文件】groupMemberReadMarkers.mjs — 群级成员已读水位侧车（本机视角）。
 * 【职责】每次本机用户调用 PUT read-marker 或收到 WS read_marker 广播时，
 *         把 { entityHash → { eventId, seq, updatedAt } } 写入群级 sidecar JSON，
 *         供 GET member-read-markers 接口返回。
 * 【存储】`{userDict}/shells/chat/groups/{groupId}/memberReadMarkers.json`
 *         结构：`{ [channelId]: { [entityHash]: { eventId, seq, updatedAt } } }`
 */
import fs from 'node:fs'

import { loadJsonFileIfExists, saveJsonFile } from '../../../../../../../scripts/json_loader.mjs'

import { groupDir } from './paths.mjs'

/**
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @returns {string} memberReadMarkers.json 绝对路径
 */
function markerFilePath(username, groupId) {
	return `${groupDir(username, groupId)}/memberReadMarkers.json`
}

/**
 * 加载群级成员已读水位。
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @returns {Record<string, Record<string, { eventId: string, seq: number, updatedAt: number }>>} channelId → entityHash → marker
 */
export function loadGroupMemberReadMarkers(username, groupId) {
	return loadJsonFileIfExists(markerFilePath(username, groupId))
}

/**
 * 写入单条成员频道已读水位（仅向前更新）。
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} entityHash 实体 hash
 * @param {{ eventId: string, seq: number }} marker 水位
 * @returns {void}
 */
export function setGroupMemberReadMarker(username, groupId, channelId, entityHash, marker) {
	const path = markerFilePath(username, groupId)
	const data = loadJsonFileIfExists(path)
	const ch = data[channelId] ??= {}
	const prev = ch[entityHash]
	const nextSeq = Number(marker.seq)
	if (prev && Number(prev.seq) >= nextSeq) return
	ch[entityHash] = {
		eventId: String(marker.eventId).trim().toLowerCase(),
		seq: nextSeq,
		updatedAt: Date.now(),
	}
	fs.mkdirSync(groupDir(username, groupId), { recursive: true })
	saveJsonFile(path, data)
}
