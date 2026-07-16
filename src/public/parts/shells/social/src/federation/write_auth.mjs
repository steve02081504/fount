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
 * owner 以自身活跃钥改/删所属实体帖：凭 profile.ownerEntityHash 与 owner 时间线密钥链复核。
 * @param {string} entityHash 时间线 owner
 * @param {string} sender 事件 sender pubKeyHash
 * @param {{ username?: string, eventType?: string, eventContent?: object }} options 需 username 以读 owner 时间线
 * @returns {Promise<boolean>} 是否授权
 */
async function isOwnerContentEventAuthorized(entityHash, sender, options) {
	const username = String(options.username || '').trim()
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
		eventType: options.eventType || 'post_delete',
		eventContent: options.eventContent || {},
		recoveryPubKeyHex: folded.recoveryPubKeyHex,
		entityKeyHistory: folded.entityKeyHistory,
	})
}

/**
 * 判定已验签的 sender 是否有权写入目标时间线。
 * @param {string} entityHash 时间线 owner（128 hex）
 * @param {string} sender 事件 sender（已验签的 pubKeyHash，64 hex）
 * @param {object} [options] 可选上下文
 * @param {string} [options.eventType] 事件 type
 * @param {object} [options.eventContent] 事件 content
 * @param {object[]} [options.priorEvents] 已有事件（折叠密钥链）
 * @param {string} [options.username] 本机 replica（owner 删帖复核读 owner 时间线）
 * @returns {Promise<boolean>} 是否授权写入
 */
export async function isTimelineWriteAuthorized(entityHash, sender, options = {}) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return false
	const normalizedSender = normalizeHex64(sender)
	if (!isHex64(normalizedSender)) return false

	const folded = foldEntityKeyHistoryFromEvents(options.priorEvents || [])
	const recoveryPubKeyHex = folded.recoveryPubKeyHex || options.recoveryPubKeyHex || null
	const entityKeyHistory = folded.entityKeyHistory?.length
		? folded.entityKeyHistory
		: options.entityKeyHistory || []

	if (recoveryPubKeyHex && entityKeyHistory.length)
		if (isEntityTimelineWriteAuthorized({
			entityHash: parsed.entityHash,
			sender: normalizedSender,
			eventType: options.eventType || '',
			eventContent: options.eventContent || {},
			recoveryPubKeyHex,
			entityKeyHistory,
		}))
			return true

	if (normalizedSender === parsed.subjectHash)
		return true

	if ((options.eventType === 'post_delete' || options.eventType === 'post_edit')
		&& await isOwnerContentEventAuthorized(parsed.entityHash, normalizedSender, options))
		return true

	return false
}
