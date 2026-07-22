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
 * @returns {object | null} 磁盘行
 */
function loadBootstrapRow(username, groupId) {
	try {
		return loadJsonFileIfExists(federationBootstrapPath(username, groupId), null)
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
	const row = {
		signalingAppId: creds.signalingAppId || 'fount-group-fed',
		roomSecret: creds.roomSecret,
		dmSessionTag: String(creds.dmSessionTag || '').trim().toLowerCase() || undefined,
		fromNodeId: String(creds.fromNodeId || '').trim() || undefined,
		setAt: Date.now(),
		settingsEventId: creds.settingsEventId?.trim() || undefined,
		powAnchorRef: creds.powAnchorRef?.trim() || undefined,
		powAnchors: Array.isArray(creds.powAnchors) ? creds.powAnchors.map(String) : undefined,
	}
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
		dmSessionTag: String(hint.dmSessionTag || '').trim().toLowerCase() || undefined,
		fromNodeId: String(hint.fromNodeId || '').trim(),
		setAt: Date.now(),
		settingsEventId: hint.settingsEventId?.trim() || undefined,
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
	if (cached) return cached
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
