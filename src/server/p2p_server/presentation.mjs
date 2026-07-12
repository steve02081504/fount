import { getLocalizedInfo } from '../../scripts/locale.mjs'
import { isPlaceholderDisplayName } from 'npm:@steve02081504/fount-p2p/entity/localized_core'
import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { getUserByUsername } from '../auth/index.mjs'
import { getAnyDefaultPart, getPartDetails } from '../parts_loader.mjs'

import { getAgentCharResolver } from 'npm:@steve02081504/fount-p2p/entity/hosting_registry'

/** 无自定义头像时的默认用户图 */
export const DEFAULT_USER_AVATAR = 'https://api.iconify.design/line-md/person.svg'

/**
 * @param {import('npm:express').Request} req HTTP 请求
 * @param {string} replicaUsername replica 登录名
 * @returns {string[]} 区域设置优先级列表
 */
export function localesFromRequest(req, replicaUsername) {
	const localeQuery = req.query?.locales
	/** @type {string[]} */
	let fromQuery = []
	if (Array.isArray(localeQuery))
		fromQuery = localeQuery.map(String)
	else if (localeQuery)
		fromQuery = String(localeQuery).split(',').map(s => s.trim()).filter(Boolean)
	if (fromQuery.length) return fromQuery
	const userLocales = getUserByUsername(replicaUsername)?.locales
	if (Array.isArray(userLocales) && userLocales.length) return userLocales
	return ['zh-CN', 'en-UK']
}

/**
 * @param {string} replicaUsername replica 登录名
 * @param {string} [groupId] 群 ID
 * @returns {Promise<string | null>} 人格部件名
 */
export async function resolvePersonanameForReplica(replicaUsername, groupId) {
	if (groupId) {
		const { getMaterializedSession } = await import('npm:@steve02081504/fount-p2p/entity/session_snapshot_registry')
		try {
			const session = await getMaterializedSession(replicaUsername, groupId)
			const fromSession = session.personas?.[replicaUsername]
			if (fromSession) return fromSession
		}
		catch {
			// 群尚未物化时回退默认人格
		}
	}

	return getAnyDefaultPart(replicaUsername, 'personas') || null
}

/**
 * @param {string} replicaUsername replica 登录名
 * @param {string} [groupId] 群 ID
 * @returns {Promise<{ displayName: string, avatar: string }>} 展示名与头像 URL
 */
export async function resolvePersonaPresentation(replicaUsername, groupId) {
	const loginName = getUserByUsername(replicaUsername)?.username || replicaUsername
	const personaname = await resolvePersonanameForReplica(replicaUsername, groupId)
	let personaName = ''
	let personaAvatar = ''
	if (personaname) {
		const { info } = await getPartDetails(replicaUsername, `personas/${personaname}`).catch(() => ({})) || {}
		personaName = String(info?.name || '').trim()
		personaAvatar = String(info?.avatar || '').trim()
	}
	return {
		displayName: personaName || loginName,
		avatar: personaAvatar || DEFAULT_USER_AVATAR,
	}
}

/**
 * @param {object} li part getInfo 切片
 * @returns {object} 默认展示字段
 */
function infoLiToDefaults(li) {
	const description = String(li?.description || '').trim()
	const description_markdown = String(li?.description_markdown || description).trim()
	return {
		name: String(li?.name || '').trim(),
		avatar: String(li?.avatar || '').trim(),
		description,
		description_markdown,
		version: String(li?.version || '').trim(),
		author: String(li?.author || '').trim(),
		home_page: String(li?.home_page || '').trim(),
		issue_page: String(li?.issue_page || '').trim(),
		tags: Array.isArray(li?.tags) ? li.tags.map(t => String(t).trim()).filter(Boolean) : [],
		links: [],
	}
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} entityHash 128 位 entityHash
 * @param {string[]} locales 区域设置列表
 * @returns {Promise<object>} 来自 part getInfo 的默认展示字段
 */
export async function getInfoDefaultsForEntity(replicaUsername, entityHash, locales) {
	const resolveAgentCharPartName = getAgentCharResolver()
	const charname = resolveAgentCharPartName?.(replicaUsername, entityHash) ?? null
	if (charname) {
		const details = await getPartDetails(replicaUsername, `chars/${charname}`).catch(() => null) || {}
		const li = getLocalizedInfo(details.info, locales) || getLocalizedInfo(details.info, ['']) || {}
		const defaults = infoLiToDefaults(li)
		return { ...defaults, name: defaults.name || charname }
	}

	if (parseEntityHash(entityHash)?.nodeHash !== getNodeHash())
		return null

	const presentation = await resolvePersonaPresentation(replicaUsername)
	const personaname = await resolvePersonanameForReplica(replicaUsername)
	let defaults = infoLiToDefaults({ name: presentation.displayName, avatar: presentation.avatar })
	if (personaname) {
		const details = await getPartDetails(replicaUsername, `personas/${personaname}`).catch(() => null) || {}
		const li = getLocalizedInfo(details.info, locales) || getLocalizedInfo(details.info, ['']) || {}
		defaults = { ...infoLiToDefaults(li), name: defaults.name || presentation.displayName, avatar: defaults.avatar || presentation.avatar }
	}
	return defaults
}

/**
 *
 */
export { isPlaceholderDisplayName }
