import { mentionsEntity } from 'fount/public/parts/shells/chat/public/shared/mentions.mjs'

import { assignEntityShellData, loadEntityShellData } from '../../../../../../../server/setting_loader.mjs'
import { memberEntityHash } from '../../entity/member.mjs'

import { isCaredBy } from './care.mjs'

const DATANAME = 'notificationPreferences'

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @returns {Record<string, object>} groupId → 偏好
 */
export function loadNotificationPreferences(username, entityHash) {
	return loadEntityShellData(username, 'chat', entityHash, DATANAME) ?? {}
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {Record<string, object>} prefs 整档偏好
 * @returns {void}
 */
export function saveNotificationPreferences(username, entityHash, prefs) {
	assignEntityShellData(username, 'chat', entityHash, DATANAME, prefs)
}

/**
 * @param {object} state 物化群状态
 * @returns {'dm' | 'group'} 群种类
 */
export function groupKindFromState(state) {
	if (state?.groupMeta?.dmKind === 'ecdh') return 'dm'
	if (state?.groupSettings?.bridge?.chatKind === 'dm') return 'dm'
	return 'group'
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} state 物化群状态
 * @returns {object} 生效偏好（频道覆盖群级）
 */
export function resolveEffectiveNotificationPreferences(username, entityHash, groupId, channelId, state) {
	const groupPrefs = loadNotificationPreferences(username, entityHash)[groupId] || {}
	const channelPrefs = groupPrefs.channels?.[channelId] || {}
	const defaults = groupKindFromState(state) === 'dm'
		? { mode: 'all', suppressEveryone: false, suppressRoles: false }
		: { mode: 'mentions', suppressEveryone: false, suppressRoles: false }
	return {
		mode: channelPrefs.mode ?? groupPrefs.mode ?? defaults.mode,
		suppressEveryone: channelPrefs.suppressEveryone ?? groupPrefs.suppressEveryone ?? defaults.suppressEveryone,
		suppressRoles: channelPrefs.suppressRoles ?? groupPrefs.suppressRoles ?? defaults.suppressRoles,
		mutedUntil: channelPrefs.mutedUntil ?? groupPrefs.mutedUntil,
	}
}

/**
 * @param {object} prefs 生效偏好
 * @returns {boolean} 是否处于 mute
 */
export function isNotifyMuted(prefs) {
	if (prefs.mutedUntil === true) return true
	return prefs.mutedUntil > Date.now()
}

/**
 * @param {object} event 含 mentions 的探测事件
 * @param {string} entityHash 收件人
 * @param {object} state 物化群状态
 * @returns {Promise<'entity' | 'role' | 'everyone' | null>} 命中方式
 */
export async function describeMentionHit(event, entityHash, state) {
	const hash = String(entityHash || '').trim().toLowerCase()
	const mentions = event?.mentions
	if (!mentions) return null
	if (mentionsEntity(mentions, hash)) return 'entity'
	if (!state) return null
	let isMember = false
	let hasRole = false
	for (const member of Object.values(state.members || {})) {
		if (member?.status !== 'active') continue
		if (memberEntityHash(member)?.toLowerCase() !== hash) continue
		isMember = true
		if (mentions.roleIds?.length && (member.roles || []).some(roleId => mentions.roleIds.includes(roleId)))
			hasRole = true
		break
	}
	if (mentions.everyone && isMember) return 'everyone'
	if (hasRole) return 'role'
	return null
}

/**
 * @param {string} username 用户
 * @param {string} recipientEntityHash 人类收件人
 * @param {object} options 裁决上下文
 * @returns {Promise<boolean>} 是否应 notifyUser
 */
export async function shouldNotifyHumanForMessage(username, recipientEntityHash, options = {}) {
	if (options.ingress === 'backfill') return false
	const authorEntityHash = String(options.authorEntityHash || '').trim().toLowerCase()
	if (authorEntityHash && await isCaredBy(username, recipientEntityHash, authorEntityHash))
		return true
	const prefs = resolveEffectiveNotificationPreferences(
		username, recipientEntityHash, options.groupId, options.channelId, options.state,
	)
	if (isNotifyMuted(prefs)) return false
	if (prefs.mode === 'nothing') return false
	if (prefs.mode === 'all') return true
	const hit = await describeMentionHit(options.probeEvent, recipientEntityHash, options.state)
	if (!hit) return false
	if (hit === 'entity') return true
	if (hit === 'role' && prefs.suppressRoles) return false
	if (hit === 'everyone' && prefs.suppressEveryone) return false
	return true
}

/**
 * @param {string} username 用户
 * @param {string} recipientEntityHash 人类收件人
 * @param {object} options 裁决上下文
 * @returns {Promise<boolean>} 是否应落 message inbox 行
 */
export async function shouldAppendMessageInboxRow(username, recipientEntityHash, options = {}) {
	const prefs = resolveEffectiveNotificationPreferences(
		username, recipientEntityHash, options.groupId, options.channelId, options.state,
	)
	return prefs.mode === 'all'
}
