/**
 * Social 时间线写入授权（联邦入站 untrusted 边界）。
 */
import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'

import { getEntityProfile } from '../lib/entityProfile.mjs'
import { timelineEventsPath } from '../paths.mjs'

import {
	foldEntityKeyHistoryFromEvents,
	isEntityTimelineWriteAuthorized,
} from './entity_key_auth.mjs'

/** @type {((username: string) => Promise<{ recoveryPubKeyHex: string, entityKeyHistory: object[], activePubKeyHex?: string } | null>) | null} */
let entityKeyChainProvider = null

/**
 * @param {(username: string) => Promise<object | null>} fn 按 replica 返回密钥链（默认 operator）
 * @returns {void}
 */
export function registerEntityKeyChainProvider(fn) {
	entityKeyChainProvider = fn
}

/**
 * @returns {((username: string) => Promise<object | null>) | null} 已注册 provider
 */
export function getEntityKeyChainProvider() {
	return entityKeyChainProvider
}

/**
 * owner 以自身活跃钥删除 agent 帖：凭 agent profile.ownerEntityHash 与 owner 时间线密钥链复核。
 * @param {string} entityHash 时间线 owner（agent）
 * @param {string} sender 事件 sender pubKeyHash
 * @param {{ username?: string }} opts 需 username 以读 owner 时间线
 * @returns {Promise<boolean>} 是否授权
 */
async function isOwnerPostDeleteAuthorized(entityHash, sender, opts) {
	const username = String(opts.username || '').trim()
	if (!username) return false
	const profile = await getEntityProfile(username, entityHash)
	const ownerEntityHash = String(profile?.ownerEntityHash || '').trim().toLowerCase()
	if (!parseEntityHash(ownerEntityHash)) return false
	let ownerEvents
	try {
		ownerEvents = await readJsonl(timelineEventsPath(username, ownerEntityHash))
	}
	catch {
		return false
	}
	if (!ownerEvents?.length) return false
	const folded = foldEntityKeyHistoryFromEvents(ownerEvents)
	if (!folded.recoveryPubKeyHex || !folded.entityKeyHistory?.length) return false
	return isEntityTimelineWriteAuthorized({
		entityHash: ownerEntityHash,
		sender,
		eventType: 'post_delete',
		eventContent: opts.eventContent || {},
		recoveryPubKeyHex: folded.recoveryPubKeyHex,
		entityKeyHistory: folded.entityKeyHistory,
	})
}

/**
 * 判定已验签的 sender 是否有权写入目标时间线。
 * @param {string} entityHash 时间线 owner（128 hex）
 * @param {string} sender 事件 sender（已验签的 pubKeyHash，64 hex）
 * @param {object} [opts] 可选上下文
 * @param {string} [opts.eventType] 事件 type
 * @param {object} [opts.eventContent] 事件 content
 * @param {object[]} [opts.priorEvents] 已有事件（折叠密钥链）
 * @param {string} [opts.username] 本机 replica（owner 删帖复核读 owner 时间线）
 * @returns {Promise<boolean>} 是否授权写入
 */
export async function isTimelineWriteAuthorized(entityHash, sender, opts = {}) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return false
	const normalizedSender = normalizeHex64(sender)
	if (!isHex64(normalizedSender)) return false

	const folded = foldEntityKeyHistoryFromEvents(opts.priorEvents || [])
	const recoveryPubKeyHex = folded.recoveryPubKeyHex || opts.recoveryPubKeyHex || null
	const entityKeyHistory = folded.entityKeyHistory?.length
		? folded.entityKeyHistory
		: opts.entityKeyHistory || []

	if (recoveryPubKeyHex && entityKeyHistory.length)
		if (isEntityTimelineWriteAuthorized({
			entityHash: parsed.entityHash,
			sender: normalizedSender,
			eventType: opts.eventType || '',
			eventContent: opts.eventContent || {},
			recoveryPubKeyHex,
			entityKeyHistory,
		}))
			return true

	if (opts.eventType === 'post_edit')
		return normalizedSender === parsed.subjectHash

	if (normalizedSender === parsed.subjectHash)
		return true

	if (opts.eventType === 'post_delete'
		&& await isOwnerPostDeleteAuthorized(parsed.entityHash, normalizedSender, opts))
		return true

	return false
}
