/**
 * Social 引导：账号即 Chat 联邦 P2P 实体，首次访问时自动准备 timeline + profile。
 */
import { ensureLocalEntityProfile } from '../../../../../../scripts/p2p/entity/profile.mjs'
import { isWritableLocalEntity, resolveOperatorEntityHash } from '../../../../../../scripts/p2p/entity/replica.mjs'
import { ensureSocialMeta } from '../timeline/append.mjs'

/**
 * 确保 entity 的 profile 与 social_meta 创世事件就绪。
 * @param {string} username replica 登录名
 * @param {string} entityHash 128 hex
 * @returns {Promise<void>}
 */
export async function ensureEntitySocialReady(username, entityHash) {
	if (!isWritableLocalEntity(username, entityHash)) return
	await ensureLocalEntityProfile(username, entityHash)
	await ensureSocialMeta(username, entityHash)
}

/**
 * 确保当前操作者（Chat 联邦 identity）的 social 时间线可用。
 * @param {string} username replica 登录名
 * @returns {Promise<string | null>} operator entityHash
 */
export async function ensureOperatorSocialReady(username) {
	const entityHash = resolveOperatorEntityHash(username)
	if (!entityHash) return null
	await ensureEntitySocialReady(username, entityHash)
	return entityHash
}
