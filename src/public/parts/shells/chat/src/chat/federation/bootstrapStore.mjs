/**
 * 入群前房间凭证 bootstrap（物化 state 尚无 roomSecret 时，供 ensureFederationRoom 首次 catch-up）。
 * 内存为主，并落盘到群目录，避免重启后孤儿 member_join 永远进不了房。
 */
import fs from 'node:fs'
import { dirname } from 'node:path'

import { loadJsonFileIfExists, saveJsonFile } from '../../../../../../../scripts/json_loader.mjs'
import { safeUnlinkSync } from '../lib/fsSafe.mjs'
import { federationBootstrapPath } from '../lib/paths.mjs'

/** @type {Map<string, { signalingAppId: string, roomSecret: string, dmSessionTag?: string, fromNodeId?: string, setAt: number, settingsEventId?: string, powAnchorRef?: string, powAnchors?: string[] }>} */
const bootstrapByKey = new Map()

/** @type {Map<string, { signalingAppId: string, roomSecret: string, dmSessionTag?: string, fromNodeId: string, setAt: number, settingsEventId?: string }>} */
const peerHintByKey = new Map()

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} Map 键
 */
export function federationBootstrapKey(username, groupId) {
	return `${username}\0${groupId}`
}

/**
 * 纠正 IPC 曾把整段 `key=value` 写入 bootstrap 的历史脏数据。
 * @param {string | undefined} value 字段值
 * @param {string[]} keys 可能被误拼进值前缀的 key 名
 * @returns {string | undefined} 去掉 `key=` 前缀后的值
 */
function stripMistakenFieldPrefix(value, keys) {
	const raw = (value || '')
	if (!raw) return undefined
	for (const key of keys) {
		const prefix = `${key}=`
		if (raw.startsWith(prefix)) return raw.slice(prefix.length).trim() || undefined
	}
	return raw
}

/**
 * 清洗 bootstrap 记录（去掉历史 `key=` 脏前缀；清洗结果始终覆盖原字段）。
 * @param {object | null} row 磁盘/内存 bootstrap 行
 * @returns {object | null} 清洗后的行（无脏前缀则原样返回）
 */
function sanitizeBootstrapRow(row) {
	if (!row) return row
	const roomSecret = stripMistakenFieldPrefix(row.roomSecret, ['roomSecret'])
	const fromNodeId = stripMistakenFieldPrefix(row.fromNodeId, ['introducerNodeHash', 'fromNodeId'])
	const powAnchorRef = stripMistakenFieldPrefix(row.powAnchorRef, ['powAnchorRef'])
	if (roomSecret === row.roomSecret && fromNodeId === row.fromNodeId && powAnchorRef === row.powAnchorRef)
		return row
	return {
		...row,
		roomSecret,
		fromNodeId,
		powAnchorRef,
	}
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} row bootstrap 行
 * @returns {void}
 */
function persistBootstrapRow(username, groupId, row) {
	const path = federationBootstrapPath(username, groupId)
	fs.mkdirSync(dirname(path), { recursive: true })
	saveJsonFile(path, row)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {object | null} 磁盘行（若含历史 `key=` 前缀脏数据则清洗并回写）
 */
function loadBootstrapRow(username, groupId) {
	try {
		const raw = loadJsonFileIfExists(federationBootstrapPath(username, groupId), null)
		if (!raw) return null
		const cleaned = sanitizeBootstrapRow(raw)
		if (cleaned !== raw) persistBootstrapRow(username, groupId, cleaned)
		return cleaned
	}
	catch {
		return null
	}
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {{ signalingAppId?: string, roomSecret: string, dmSessionTag?: string, fromNodeId?: string, powAnchorRef?: string, powAnchors?: string[] }} creds 邀请/bootstrap 凭证
 * @returns {void}
 */
export function setFederationBootstrap(username, groupId, creds) {
	if (!creds.roomSecret) return
	const row = sanitizeBootstrapRow({
		signalingAppId: creds.signalingAppId || 'fount-group-fed',
		roomSecret: creds.roomSecret,
		dmSessionTag: creds.dmSessionTag || undefined,
		fromNodeId: creds.fromNodeId || undefined,
		setAt: Date.now(),
		settingsEventId: creds.settingsEventId || undefined,
		powAnchorRef: creds.powAnchorRef || undefined,
		powAnchors: Array.isArray(creds.powAnchors) ? creds.powAnchors : undefined,
	})
	if (!row?.roomSecret) return
	persistBootstrapRow(username, groupId, row)
	bootstrapByKey.set(federationBootstrapKey(username, groupId), row)
	peerHintByKey.delete(federationBootstrapKey(username, groupId))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {{ signalingAppId?: string, roomSecret: string, dmSessionTag?: string, fromNodeId: string, settingsEventId?: string }} hint 邻居提供的口令提示
 * @returns {void}
 */
export function setPeerRoomHint(username, groupId, hint) {
	if (!hint.roomSecret) return
	peerHintByKey.set(federationBootstrapKey(username, groupId), {
		signalingAppId: hint.signalingAppId || 'fount-group-fed',
		roomSecret: hint.roomSecret,
		dmSessionTag: hint.dmSessionTag || undefined,
		fromNodeId: hint.fromNodeId,
		setAt: Date.now(),
		settingsEventId: hint.settingsEventId || undefined,
	})
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {{ signalingAppId: string, roomSecret: string, dmSessionTag?: string, fromNodeId?: string } | undefined} 暂存凭证或 undefined
 */
export function peekFederationBootstrap(username, groupId) {
	const key = federationBootstrapKey(username, groupId)
	const cached = bootstrapByKey.get(key)
	if (cached) {
		const cleaned = sanitizeBootstrapRow(cached)
		if (cleaned !== cached && cleaned?.roomSecret) {
			bootstrapByKey.set(key, cleaned)
			persistBootstrapRow(username, groupId, cleaned)
		}
		return cleaned
	}
	const disk = loadBootstrapRow(username, groupId)
	if (!disk?.roomSecret) return undefined
	bootstrapByKey.set(key, disk)
	return disk
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {{ signalingAppId: string, roomSecret: string, dmSessionTag?: string, fromNodeId: string, setAt: number, settingsEventId?: string } | undefined} 邻居房间凭证提示
 */
export function peekPeerRoomHint(username, groupId) {
	return peerHintByKey.get(federationBootstrapKey(username, groupId))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {{ bootstrap?: object, peerHint?: object } | undefined} 优先 bootstrap，其次 peer hint
 */
export function peekPreferredRoomOverride(username, groupId) {
	return peekFederationBootstrap(username, groupId) || peekPeerRoomHint(username, groupId)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {void}
 */
export function clearFederationBootstrap(username, groupId) {
	const key = federationBootstrapKey(username, groupId)
	bootstrapByKey.delete(key)
	peerHintByKey.delete(key)
	try {
		safeUnlinkSync(federationBootstrapPath(username, groupId))
	}
	catch { /* ignore */ }
}
