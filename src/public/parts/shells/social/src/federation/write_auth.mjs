/**
 * Social 时间线写入授权（联邦入站 untrusted 边界）。
 */
import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import {
	activeSenderHashFromPubKeyHex,
	createGenesisKeyHistory,
	recoverySubjectHashFromPubKeyHex,
} from 'npm:@steve02081504/fount-p2p/federation/entity_key_chain'

import { getEntityProfile } from '../lib/entityProfile.mjs'
import { timelineEventsPath } from '../paths.mjs'

import {
	foldEntityKeyHistoryFromEvents,
	isEntityTimelineWriteAuthorized,
} from './entity_key_auth.mjs'

/**
 * 从当前入站事件引导密钥链（无本地先验时）。
 * @param {{ entityHash: string, subjectHash: string }} parsed 已解析 entityHash
 * @param {string} sender 已规范化 sender
 * @param {{ eventType?: string, eventContent?: object, senderPubKeyHex?: string }} options 事件上下文
 * @returns {{ recoveryPubKeyHex: string | null, entityKeyHistory: object[] } | null} 引导结果
 */
function bootstrapKeyChainFromEvent(parsed, sender, options) {
	const type = options.eventType || ''
	const content = options.eventContent || {}

	if (type === 'social_meta') {
		const recovery = normalizeHex64(content.recoveryPubKeyHex || '')
		if (!isHex64(recovery)) return null
		if (recoverySubjectHashFromPubKeyHex(recovery) !== parsed.subjectHash) return null
		return { recoveryPubKeyHex: recovery, entityKeyHistory: [] }
	}

	if (type === 'entity_key_rotate' && Number(content.generation) === 0) {
		const recovery = normalizeHex64(options.senderPubKeyHex || '')
		if (!isHex64(recovery)) return null
		if (recoverySubjectHashFromPubKeyHex(recovery) !== parsed.subjectHash) return null
		if (normalizeHex64(sender) !== parsed.subjectHash) return null
		const active = normalizeHex64(content.activePubKeyHex || '')
		return {
			recoveryPubKeyHex: recovery,
			entityKeyHistory: isHex64(active) ? createGenesisKeyHistory(recovery, active) : [],
		}
	}

	return null
}

/**
 * EVFS 验签 profile 作跨节点活跃钥 attestation（readPublicFile 已锚定 recovery）。
 * @param {string} username replica
 * @param {string} entityHash 时间线 owner
 * @param {string} sender 事件 sender
 * @returns {Promise<boolean>} 是否与 profile.activePubKeyHex 匹配
 */
async function isAuthorizedByEvfsProfile(username, entityHash, sender) {
	const { readPublicFile } = await import('npm:@steve02081504/fount-p2p/files/evfs')
	const plain = await readPublicFile(username, entityHash, 'profile.json')
	if (!plain) return false
	let payload
	try {
		payload = JSON.parse(plain.toString('utf8'))
	}
	catch {
		return false
	}
	if (String(payload?.entityHash || '').toLowerCase() !== entityHash) return false
	const active = normalizeHex64(payload.activePubKeyHex || '')
	if (!isHex64(active)) return false
	return activeSenderHashFromPubKeyHex(active) === sender
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
 * @param {string} [options.username] 本机 replica（owner 删帖 / EVFS 兜底）
 * @param {string} [options.senderPubKeyHex] 事件 senderPubKey（gen0 引导用）
 * @returns {Promise<boolean>} 是否授权写入
 */
export async function isTimelineWriteAuthorized(entityHash, sender, options = {}) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return false
	const normalizedSender = normalizeHex64(sender)
	if (!isHex64(normalizedSender)) return false

	let { recoveryPubKeyHex, entityKeyHistory } = foldEntityKeyHistoryFromEvents(options.priorEvents || [])

	if (!recoveryPubKeyHex || !entityKeyHistory.length) {
		const boot = bootstrapKeyChainFromEvent(parsed, normalizedSender, options)
		if (boot) {
			recoveryPubKeyHex = recoveryPubKeyHex || boot.recoveryPubKeyHex
			if (!entityKeyHistory.length && boot.entityKeyHistory.length)
				entityKeyHistory = boot.entityKeyHistory
		}
	}

	if (recoveryPubKeyHex && isEntityTimelineWriteAuthorized({
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

	// 无先验链时：EVFS 验签 profile 的 activePubKeyHex 作 attestation 兜底
	if (options.username && await isAuthorizedByEvfsProfile(options.username, parsed.entityHash, normalizedSender))
		return true

	return false
}
